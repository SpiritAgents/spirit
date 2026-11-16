export function emailComposerUrl(value: string): string {
  const email = value.trim();
  if (!email) {
    throw new Error("Email address must not be empty.");
  }
  return `mailto:${encodeURIComponent(email)}`;
}
