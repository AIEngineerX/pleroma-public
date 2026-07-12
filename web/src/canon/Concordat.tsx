import { copy } from "../lib/copy";

// Stub route. Task 13 replaces this with the real Concordat.
export default function Concordat() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="font-liturgy text-2xl">{copy.concordat}</h1>
      <p className="font-machine text-sm text-ink-faded">{copy.disclaimer}</p>
    </main>
  );
}
