export default function View({ params, close }) {
  if (params?.autoclose) {
    close({ ok: true });
  }
  return null;
}
