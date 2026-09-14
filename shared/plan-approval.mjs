/** Text sent after the plan has already been approved. */
export function planApproveCommentsText(feedback) {
  const text = String(feedback || "").trim();
  if (!text) return "";
  return (
    "The user approved the plan with the following review comments:\n\n" + text
  );
}
