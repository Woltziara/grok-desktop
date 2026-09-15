/** Identity based reconciliation: a slow receipt must not erase later typing,
 * newly attached files or quotes, even if the visible text happens to match. */
export function draftFingerprint(draft) {
  const parts = [draft.text, draft.textToken, Boolean(draft.highDetail), (draft.files || []).map(f => f.id), (draft.quotes || []).map(q => [q.id, q.text])];
  if (draft.browserReference) parts.push(draft.browserReference);
  return JSON.stringify(parts);
}
export function appendDraftFiles(draft, files) {
  const byId = new Map((draft.files || []).map(file => [file.id, file]));
  for (const file of files) if (!byId.has(file.id)) byId.set(file.id, file);
  return { ...draft, files: [...byId.values()] };
}
export function subtractSubmittedDraft(current, submitted) {
  const sameText = current.text === submitted.text && current.textToken === submitted.textToken;
  const sentFiles = new Map((submitted.files || []).map(file => [file.id, file]));
  const sentQuotes = new Map((submitted.quotes || []).map(quote => [quote.id, quote.text]));
  const next = { ...current,
    text: sameText ? '' : current.text,
    cursor: sameText ? 0 : current.cursor,
    files: (current.files || []).filter(file => {
      const sent = sentFiles.get(file.id);
      // A changed attachment or changed image quality is a new draft intention.
      return !sent || JSON.stringify(sent) !== JSON.stringify(file) || (file.kind === 'image' && current.highDetail !== submitted.highDetail);
    }),
    quotes: (current.quotes || []).filter(q => sentQuotes.get(q.id) !== q.text),
    browserReference: JSON.stringify(current.browserReference || null) === JSON.stringify(submitted.browserReference || null)
      ? undefined
      : current.browserReference,
  };
  if (next.submission?.id === submitted.submission?.id) delete next.submission;
  if (!next.files.some(f => f.kind === 'image')) next.highDetail = false;
  return next;
}
