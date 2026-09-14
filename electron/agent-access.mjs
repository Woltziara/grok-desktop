/** Apply owner-selected access settings to every live or parked client. */
export function applyAgentAccess(agent, policy) {
  if (!agent) return;
  if (typeof policy.sandboxTerminal === "boolean") {
    agent.setSandboxTerminal(policy.sandboxTerminal);
  }
  if (typeof policy.allowOutsideProject === "boolean") {
    agent.setAllowOutsideProject(policy.allowOutsideProject);
  }
}

export function applyWindowAgentAccess(windows, policy) {
  const seen = new Set();
  for (const window of windows.values()) {
    const agents = [window.agent, ...(window.parkedAgents?.values() || [])];
    for (const agent of agents) {
      if (!agent || seen.has(agent)) continue;
      seen.add(agent);
      applyAgentAccess(agent, policy);
    }
  }
  return seen.size;
}
