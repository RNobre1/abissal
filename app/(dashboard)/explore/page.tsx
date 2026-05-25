import { Explorer } from "./explorer";

export default function ExplorePage() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <header className="mb-10">
        <span className="label">explorar</span>
        <h2 className="mt-2">faça suas próprias perguntas</h2>
      </header>

      <Explorer />
    </main>
  );
}
