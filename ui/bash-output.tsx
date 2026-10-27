export function BashOutput({ text, receipts }: { text: string; receipts: Record<string, any>[] }) {
  // Only resolve an ID from the returned prefix, never a URL or arbitrary content.
  const id = /^\{"receiptId":"([0-9a-f-]{36})"/.exec(text)?.[1];
  const result = id ? receipts.find((r) => r.id === id) : undefined;
  if (!result)
    return (
      <p>
        {id
          ? 'Loading Bash output…'
          : 'Bash did not return a complete receipt. Inspect Environments for details.'}
      </p>
    );
  return (
    <details open>
      <summary>
        Bash · {result.target} · {result.status}
        {result.exitCode != null ? ` · exit ${result.exitCode}` : ''}
        {result.timedOut ? ' · timed out' : ''}
        {result.truncated ? ' · output limit' : ''}
        {result.cancelled ? ' · stopped' : ''}
      </summary>
      <p className="fine">{result.cwd}</p>
      {(result.message || result.error) && <p>{result.message || result.error}</p>}
      <p className="fine">Standard output</p>
      <pre aria-label="Bash standard output">{result.stdout || '(no stdout)'}</pre>
      {result.stderr && (
        <>
          <p className="fine">Standard error</p>
          <pre aria-label="Bash standard error">{result.stderr}</pre>
        </>
      )}
    </details>
  );
}
