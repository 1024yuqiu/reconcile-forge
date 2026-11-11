// Only the latest requested preview may publish data, errors or loading completion.
export function latestPreview() {
  let sequence = 0;
  return {
    begin() {
      const request = ++sequence;
      return { current: () => request === sequence };
    }
  };
}
