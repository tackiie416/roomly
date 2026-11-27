/** Recuentos del panel en una cuadrícula accesible (lista de términos). */
export function MetricGroup({
  title,
  items,
  testId,
}: {
  title: string;
  items: { label: string; value: number | string; hint?: string }[];
  testId?: string;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h2 className="font-medium">{title}</h2>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex flex-col-reverse gap-1 rounded-[var(--radius)] border border-[var(--border)] p-3"
          >
            <dt className="text-xs text-[var(--muted)]">
              {item.label}
              {item.hint ? <span className="block">{item.hint}</span> : null}
            </dt>
            <dd className="text-2xl font-medium tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
