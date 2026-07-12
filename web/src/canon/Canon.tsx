import { copy } from "../lib/copy";

// Stub route. Task 12 replaces this with the real scripture archive.
export default function Canon() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="font-liturgy text-2xl">{copy.canon}</h1>
      <p className="font-machine text-sm text-ink-faded">{copy.noHeart}</p>
    </main>
  );
}
