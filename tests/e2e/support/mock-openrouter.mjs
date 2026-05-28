// Mock OpenRouter para os E2E de OCR (bet-slip-photo stub).
// Sobe via webServer do Playwright; o app aponta OPENROUTER_BASE_URL aqui.
// Server Actions chamam o OpenRouter no servidor (page.route não intercepta),
// então mockamos no nível HTTP, server-to-server.
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_OPENROUTER_PORT ?? 8787);

// Mesmo shape do MOCK_OPENROUTER_RESPONSE do spec — 2 legs (Flamengo, Arsenal).
const RESPONSE = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          legs: [
            {
              home: "Flamengo",
              away: "Palmeiras",
              market: "1X2",
              side: "Casa",
              odd_taken: 2.1,
              league: "Brasileirão Série A",
              kickoff_iso: null,
            },
            {
              home: "Arsenal",
              away: "Chelsea",
              market: "BTTS",
              side: "Sim",
              odd_taken: 1.75,
              league: "Premier League",
              kickoff_iso: null,
            },
          ],
          stake_total: 50,
          odd_combined: 3.675,
          house_detected: "superbet",
        }),
      },
    },
  ],
};

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  // Qualquer POST .../chat/completions → resposta canônica.
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(RESPONSE));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[mock-openrouter] listening on http://127.0.0.1:${PORT}`);
});
