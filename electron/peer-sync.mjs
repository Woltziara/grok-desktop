/**
 * Align this Mac with the other (Tailscale / Thunderbolt).
 * Newer mtime wins. Does not delete files that exist only on one side.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { authJsonPath, grokHomeDir } from "./grok-home.mjs";
import {
  saveAuthSnapshotFromFile,
  saveCurrentSnapshot,
} from "./account-auth.mjs";
import { publicAccountRow, summarizeAuthRaw } from "../shared/account-auth.mjs";
import {
  GROK_EXCLUDES,
  GROK_INCLUDE_TOP,
  PROJECTS_EXCLUDES,
  alignmentPreviewText,
  parseRsyncDryRun,
  peerHostsForThisMachine,
  rsyncExcludeArgs,
  summarizeFileList,
} from "../shared/peer-sync.mjs";

const USER = os.userInfo().username;

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: opts.env || process.env,
      cwd: opts.cwd,
    });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, opts.timeoutMs || 120_000);
    child.stdout?.on("data", (d) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(t);
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

function pingHost(host) {
  return run("/sbin/ping", ["-c", "1", "-W", "1000", host], {
    timeoutMs: 3000,
  }).then((r) => r.code === 0);
}

/**
 * @param {string} userData
 */
export function peerKeyPaths(userData) {
  const dir = path.join(userData, "peer-sync");
  return {
    dir,
    privateKey: path.join(dir, "id_ed25519"),
    publicKey: path.join(dir, "id_ed25519.pub"),
  };
}

export function ensurePeerKey(userData) {
  const keys = peerKeyPaths(userData);
  fs.mkdirSync(keys.dir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(keys.privateKey) && fs.existsSync(keys.publicKey)) {
    return keys;
  }
  return run("ssh-keygen", [
    "-t",
    "ed25519",
    "-N",
    "",
    "-f",
    keys.privateKey,
    "-C",
    "grok-desktop-peer",
  ]).then((r) => {
    if (r.code !== 0) throw new Error(r.stderr || "ssh-keygen failed");
    return keys;
  });
}

function sshBaseArgs(privateKey, host) {
  return [
    "-i",
    privateKey,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
    "-o",
    "StrictHostKeyChecking=accept-new",
    `${USER}@${host}`,
  ];
}

async function pickReachableHost(hosts, privateKey) {
  for (const host of hosts) {
    const up = await pingHost(host);
    if (!up) continue;
    if (!privateKey || !fs.existsSync(privateKey)) {
      return { host, ping: true, ssh: false };
    }
    const r = await run(
      "ssh",
      [...sshBaseArgs(privateKey, host), "echo", "ok"],
      { timeoutMs: 12_000 },
    );
    if (r.code === 0 && /\bok\b/.test(r.stdout)) {
      return { host, ping: true, ssh: true };
    }
    return { host, ping: true, ssh: false };
  }
  return { host: hosts[0] || "", ping: false, ssh: false };
}

/**
 * @param {string} userData
 */
export async function peerStatus(userData) {
  const peer = peerHostsForThisMachine(os.hostname());
  const keys = peerKeyPaths(userData);
  const paired = fs.existsSync(keys.privateKey);
  const reach = await pickReachableHost(
    peer.hosts,
    paired ? keys.privateKey : "",
  );
  return {
    role: peer.role,
    label: peer.label,
    hosts: peer.hosts,
    host: reach.host,
    online: Boolean(reach.ping),
    paired,
    sshReady: Boolean(reach.ssh),
    projectsPath: path.join(os.homedir(), "Projects"),
    grokHome: grokHomeDir(),
  };
}

function askPassScript(password, dir) {
  const p = path.join(dir, "askpass.sh");
  const body = `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(String(password || ""))}\n`;
  fs.writeFileSync(p, body, { mode: 0o700 });
  return p;
}

/**
 * One-time: install this Mac's key on the other Mac.
 * @param {string} userData
 * @param {string} password
 */
export async function pairPeer(userData, password) {
  const status = await peerStatus(userData);
  if (!status.online) {
    return { ok: false, error: `找不到${status.label}。开着 Tailscale，或用雷雳连上。` };
  }
  const keys = await ensurePeerKey(userData);
  const pub = fs.readFileSync(keys.publicKey, "utf8").trim();
  const ask = askPassScript(password, keys.dir);
  const remote =
    "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; " +
    `grep -qxF ${JSON.stringify(pub)} ~/.ssh/authorized_keys || echo ${JSON.stringify(pub)} >> ~/.ssh/authorized_keys`;
  const env = {
    ...process.env,
    SSH_ASKPASS: ask,
    SSH_ASKPASS_REQUIRE: "force",
    DISPLAY: process.env.DISPLAY || ":0",
  };
  const r = await run(
    "ssh",
    [
      "-o",
      "PreferredAuthentications=password,keyboard-interactive",
      "-o",
      "PubkeyAuthentication=no",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=12",
      `${USER}@${status.host}`,
      remote,
    ],
    { env, timeoutMs: 25_000 },
  );
  try {
    fs.unlinkSync(ask);
  } catch {
    /* ignore */
  }
  if (r.code !== 0) {
    return {
      ok: false,
      error: "配对没成功。请确认对面开了远程登录，密码没错。",
      detail: (r.stderr || r.stdout || "").slice(-400),
    };
  }
  const check = await run(
    "ssh",
    [...sshBaseArgs(keys.privateKey, status.host), "echo", "ok"],
    { timeoutMs: 12_000 },
  );
  if (check.code !== 0) {
    return { ok: false, error: "钥匙写上了，但还登不进去。" };
  }
  return { ok: true, host: status.host, label: status.label };
}

function rsyncSsh(privateKey) {
  return `ssh -i ${JSON.stringify(privateKey)} -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new`;
}

async function rsyncUpdate(src, dest, excludes, privateKey, dryRun) {
  const args = [
    "-a",
    "-u",
    "-v",
    "-e",
    rsyncSsh(privateKey),
    ...rsyncExcludeArgs(excludes),
  ];
  if (dryRun) args.unshift("-n");
  args.push(src, dest);
  const r = await run("rsync", args, { timeoutMs: 30 * 60_000 });
  return {
    ok: r.code === 0,
    files: parseRsyncDryRun(r.stdout),
    error: r.code === 0 ? null : (r.stderr || r.stdout || "rsync failed").slice(-500),
  };
}

function grokIncludePaths(home) {
  return GROK_INCLUDE_TOP.map((rel) => path.join(home, rel)).filter((p) =>
    fs.existsSync(p),
  );
}

/**
 * Dry-run or apply two-way newer-wins for Grok home + ~/Projects.
 * @param {string} userData
 * @param {{ apply?: boolean }} [opts]
 */
export async function alignPeer(userData, opts = {}) {
  const apply = Boolean(opts.apply);
  const status = await peerStatus(userData);
  if (!status.online) {
    return { ok: false, error: `找不到${status.label}。开着 Tailscale，或用雷雳连上。` };
  }
  if (!status.sshReady) {
    return { ok: false, error: "还没配对。先点「配对僚机」，输入对面的登录密码一次。", needPair: true };
  }
  const keys = peerKeyPaths(userData);
  const host = status.host;
  const remotePrefix = `${USER}@${host}:`;

  const grokHome = grokHomeDir();
  const projects = path.join(os.homedir(), "Projects");
  const remoteGrok = remotePrefix + grokHome.replace(/\/$/, "") + "/";
  const localGrok = grokHome.replace(/\/$/, "") + "/";
  const remoteProjects = remotePrefix + projects.replace(/\/$/, "") + "/";
  const localProjects = projects.replace(/\/$/, "") + "/";

  fs.mkdirSync(grokHome, { recursive: true });
  fs.mkdirSync(projects, { recursive: true });

  // Ensure listed top-level grok files exist as destinations
  for (const p of grokIncludePaths(grokHome)) {
    /* existence only */
    void p;
  }

  const grokPull = await rsyncUpdate(
    remoteGrok,
    localGrok,
    GROK_EXCLUDES,
    keys.privateKey,
    !apply,
  );
  if (!grokPull.ok) {
    return { ok: false, error: "对齐 Grok 的家失败（拉回来）。", detail: grokPull.error };
  }
  const grokPush = await rsyncUpdate(
    localGrok,
    remoteGrok,
    GROK_EXCLUDES,
    keys.privateKey,
    !apply,
  );
  if (!grokPush.ok) {
    return { ok: false, error: "对齐 Grok 的家失败（送过去）。", detail: grokPush.error };
  }

  let projPull = { ok: true, files: [] };
  let projPush = { ok: true, files: [] };
  if (fs.existsSync(projects)) {
    projPull = await rsyncUpdate(
      remoteProjects,
      localProjects,
      PROJECTS_EXCLUDES,
      keys.privateKey,
      !apply,
    );
    if (!projPull.ok) {
      return { ok: false, error: "对齐 Projects 失败（拉回来）。", detail: projPull.error };
    }
    projPush = await rsyncUpdate(
      localProjects,
      remoteProjects,
      PROJECTS_EXCLUDES,
      keys.privateKey,
      !apply,
    );
    if (!projPush.ok) {
      return { ok: false, error: "对齐 Projects 失败（送过去）。", detail: projPush.error };
    }
  }

  const pull = [...grokPull.files, ...projPull.files];
  const push = [...grokPush.files, ...projPush.files];
  return {
    ok: true,
    applied: apply,
    label: status.label,
    host,
    preview: alignmentPreviewText({ pull, push }),
    grok: {
      pull: summarizeFileList(grokPull.files),
      push: summarizeFileList(grokPush.files),
    },
    projects: {
      pull: summarizeFileList(projPull.files),
      push: summarizeFileList(projPush.files),
    },
  };
}

function scpKeyArgs(privateKey) {
  return [
    "-i",
    privateKey,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=12",
    "-o",
    "StrictHostKeyChecking=accept-new",
  ];
}

async function scpCopy(privateKey, src, dest) {
  const r = await run("scp", [...scpKeyArgs(privateKey), src, dest], {
    timeoutMs: 30_000,
  });
  return {
    ok: r.code === 0,
    error: r.code === 0 ? null : (r.stderr || r.stdout || "scp failed").slice(-400),
  };
}

function summarizeAuthFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return publicAccountRow(
      summarizeAuthRaw(JSON.parse(fs.readFileSync(filePath, "utf8"))),
    );
  } catch {
    return null;
  }
}

/**
 * Identity on the other Mac. Tokens never leave this function.
 * @param {string} userData
 */
export async function peerAccountSummary(userData) {
  const status = await peerStatus(userData);
  if (!status.online) {
    return { ok: false, online: false, sshReady: false, account: null, label: status.label };
  }
  if (!status.sshReady) {
    return {
      ok: false,
      online: true,
      sshReady: false,
      needPair: true,
      account: null,
      label: status.label,
    };
  }
  const keys = peerKeyPaths(userData);
  const tmp = path.join(
    os.tmpdir(),
    `grok-peer-auth-${process.pid}-${Date.now()}.json`,
  );
  const remote = `${USER}@${status.host}:${authJsonPath()}`;
  try {
    const copied = await scpCopy(keys.privateKey, remote, tmp);
    if (!copied.ok) {
      return {
        ok: false,
        online: true,
        sshReady: true,
        account: null,
        label: status.label,
        error: "看不了对面现在登的是谁。",
      };
    }
    const account = summarizeAuthFile(tmp);
    if (account) saveAuthSnapshotFromFile(tmp);
    return {
      ok: true,
      online: true,
      sshReady: true,
      account,
      label: status.label,
      host: status.host,
    };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Copy ~/.grok/auth.json one way. The overwritten side is snapshotted first.
 * @param {string} userData
 * @param {"push" | "pull"} direction
 */
export async function copyAuthToPeer(userData, direction) {
  const dir = direction === "pull" ? "pull" : "push";
  const status = await peerStatus(userData);
  if (!status.online) {
    return { ok: false, error: `找不到${status.label}。开着 Tailscale，或用雷雳连上。` };
  }
  if (!status.sshReady) {
    return {
      ok: false,
      error: "还没配对。先点「配对僚机」，输入对面的登录密码一次。",
      needPair: true,
    };
  }
  const keys = peerKeyPaths(userData);
  const host = status.host;
  const localAuth = authJsonPath();
  const remoteAuth = `${USER}@${host}:${localAuth}`;
  const tmp = path.join(
    os.tmpdir(),
    `grok-peer-auth-${process.pid}-${Date.now()}.json`,
  );

  try {
    saveCurrentSnapshot();
    const pulled = await scpCopy(keys.privateKey, remoteAuth, tmp);
    if (pulled.ok) {
      saveAuthSnapshotFromFile(tmp);
    }

    if (dir === "push") {
      if (!fs.existsSync(localAuth)) {
        return { ok: false, error: "这台还没有登录可以送。" };
      }
      const snapDir = path.join(grokHomeDir(), "account-snapshots");
      await run(
        "ssh",
        [
          ...sshBaseArgs(keys.privateKey, host),
          `mkdir -p ${JSON.stringify(snapDir)}`,
        ],
        { timeoutMs: 12_000 },
      );
      if (pulled.ok && fs.existsSync(tmp)) {
        const peerRow = summarizeAuthFile(tmp);
        if (peerRow?.id) {
          await scpCopy(
            keys.privateKey,
            tmp,
            `${USER}@${host}:${path.join(snapDir, `${peerRow.id}.json`)}`,
          );
        }
      }
      const sent = await scpCopy(keys.privateKey, localAuth, remoteAuth);
      if (!sent.ok) {
        return { ok: false, error: "登录没送过去。", detail: sent.error };
      }
      await run(
        "ssh",
        [
          ...sshBaseArgs(keys.privateKey, host),
          `chmod 600 ${JSON.stringify(localAuth)}`,
        ],
        { timeoutMs: 12_000 },
      );
      await run(
        "ssh",
        [
          ...sshBaseArgs(keys.privateKey, host),
          'osascript -e \'tell application "Grok Desktop" to quit\' >/dev/null 2>&1; sleep 1; open -a "Grok Desktop" >/dev/null 2>&1 || true',
        ],
        { timeoutMs: 20_000 },
      );
      const local = summarizeAuthFile(localAuth);
      return {
        ok: true,
        direction: "push",
        label: status.label,
        local,
        peer: local,
        preview: `已经把这边的登录送到${status.label}。对面原来的登录收起来了，以后还能换回来。`,
      };
    }

    if (!pulled.ok || !fs.existsSync(tmp)) {
      return { ok: false, error: `${status.label} 上没有可以拿来的登录。` };
    }
    fs.mkdirSync(path.dirname(localAuth), { recursive: true, mode: 0o700 });
    fs.copyFileSync(tmp, localAuth);
    try {
      fs.chmodSync(localAuth, 0o600);
    } catch {
      /* ignore */
    }
    saveCurrentSnapshot();
    const local = summarizeAuthFile(localAuth);
    return {
      ok: true,
      direction: "pull",
      needsRestart: true,
      label: status.label,
      local,
      peer: local,
      preview: `已经把${status.label}的登录拿到这台。这边原来的登录收起来了。`,
    };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}
