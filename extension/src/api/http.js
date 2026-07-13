export async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
