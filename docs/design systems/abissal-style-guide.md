# Abismo Habitado — Guia de Estilo

> Sistema de design pessoal. Versão 1.0. Maio de 2026.

---

## Os 6 Princípios

Esses princípios não descrevem estética — descrevem intenção. Toda decisão visual deve ser justificável por pelo menos um deles.

### 1. Profundidade Deliberada
Nada existe para decorar. Cada elemento tem peso e função. O design não explica — ele revela camada por camada. Quem não presta atenção não merece ver o fundo.

**Na prática:** Nunca use ícone de engrenagem para "configurações". Nunca use gradiente para preencher espaço. Se um elemento pode ser removido sem perder informação, remova.

### 2. Autoridade Sem Ostentação
A sensação de "foi feito por quem sabe" sem nunca anunciar isso. Patina de credibilidade — como coisa que parece mais velha do que é, porque foi construída para durar.

**Na prática:** Mono em metadados, timestamps e numeração estrutural. Não bold demais, não grande demais. A autoridade está na precisão, não no volume.

### 3. Acento Vivo
90% contenção absoluta. 10% que rompe com raiz e calor. O acento não enfeita — ele marca. Por ser raro, impacta. Por ter origem, não parece arbitrário.

**Na prática:** O vermelho aparece em no máximo 2-3 pontos por composição. Quando uma seção inteira vira vermelho, é um evento — não decoração.

### 4. Forma com Memória
Curvas que têm lógica, não que suavizam. Texturas que sugerem tempo — estratos, sedimentação, uso. Nunca polido demais. A textura `strata` é o instrumento.

**Na prática:** Aplique `strata` em fundos de seção. Nunca use grain genérico. Border-radius é orgânico (8-14px), nunca zero e nunca pill.

### 5. Escala que Humilha (bem)
A grandiosidade não é sobre o criador. É sobre fazer quem interage sentir que está diante de algo maior que ele. Como Shadow of the Colossus. Como o abismo de Subnautica.

**Na prática:** Headlines de hero em 120px+. Layout que tem pelo menos um elemento que não cabe "direito" no grid — que vaza, que é grande demais. O desconforto é intencional.

### 6. Vínculo pelo Abismo
Design que não isola — que convida. Não é social no sentido raso. É tribal: quem entra, pertence. O calor existe para quem atravessa a profundeza junto.

**Na prática:** O vermelho (Garantido) é o símbolo do vínculo. Aparece em pontos de comunidade, identidade, pertencimento. O azul (depth) é individual e sistêmico. Eles não competem — são polos.

---

## Sistema de Cores

### Filosofia
Dois polos que coexistem sem se cancelar:
- **Abismo** (void, surfaces, depth blue) — cosmos, silêncio, profundeza técnica
- **Garantido** (vermelho, branco) — raiz amazônica, calor, pertencimento tribal

### Paleta Base

| Token | Valor | Uso |
|---|---|---|
| `void` | `#09090F` | Fundo de toda interface |
| `surface-1` | `#111118` | Painéis, sidebars |
| `surface-2` | `#18181F` | Cards, modais |
| `surface-3` | `#21212A` | Hover states, inputs |

### Texto

| Token | Valor | Uso |
|---|---|---|
| `text-display` | `#F8F5EF` | Headlines em Fraunces — branco quase puro |
| `text-primary` | `#F0ECE3` | Corpo principal, títulos de card |
| `text-secondary` | `#7A7872` | Descrições, subtítulos, corpo de apoio |
| `text-muted` | `#3F3D3A` | Metadados, timestamps, disabled |

> O branco é intencional e puro — referência direta ao branco do Boi Garantido. Não é off-white "envelhecido". É presença.

### Acentos

| Token | Valor | Polo | Uso |
|---|---|---|---|
| `vermelho` | `#C42B2B` | Garantido | Identidade, comunidade, CTA primário, pull quotes |
| `vermelho-hi` | `#D43535` | Garantido | Hover, focus, estado ativo |
| `depth` | `#1A5FAD` | Abismo | Dados, sistemas, progresso, estado nominal |
| `depth-hi` | `#2272C8` | Abismo | Hover de elementos técnicos |
| `warning` | `#B87A1A` | — | Estado de degradação. Nunca confundir com vermelho. |

### Regras de Uso

**Vermelho não é cor de erro.** Erro usa um estado semântico separado. Vermelho é identidade.

**90/10.** Em qualquer composição, 90% deve ser void/surfaces/texto. O vermelho aparece em 10% — no máximo. Quando isso quebra (a seção vermelho da landing), é um evento deliberado, não exceção à regra.

**Vermelho vs. Depth.** Nunca use os dois no mesmo componente para o mesmo tipo de informação. Vermelho = humano, quente, identidade. Depth = sistêmico, frio, técnico. Se ambos aparecem no mesmo componente, devem ter funções claramente diferentes.

---

## Tipografia

### Hierarquia de Vozes

O sistema tem três vozes com funções distintas:

**Fraunces** — A voz narrativa  
Literária, óptica, com caráter. Usada para: headlines de página, pull quotes, títulos de seção, taglines. Constrói antes de concluir. Aceita itálico como instrumento de mudança de voz dentro do mesmo elemento.

```
Fraunces 300 — headlines e display
Fraunces 300 italic — a voz que suaviza ou muda direção
Fraunces 400 — quando precisa de mais peso em corpo
```

**DM Sans** — A voz do rigor  
Limpa, sem ser genérica. Usada para: corpo de texto, UI, labels de componente, botões. Técnico com alma.

```
DM Sans 300 — corpo longo, documentos
DM Sans 400 — corpo padrão, UI
DM Sans 500 — botões, labels de ação
```

**JetBrains Mono** — A voz da máquina  
Para: código, métricas, timestamps, numeração estrutural, tags de seção em uppercase, metadados.

```
JetBrains Mono 400 — tudo
JetBrains Mono 500 — números de métrica em destaque
```

### Escala e Contextos

| Tamanho | Fonte | Peso | Uso |
|---|---|---|---|
| 120px+ | Fraunces | 300 | Hero monumental — desconforta, é intencional |
| 64-88px | Fraunces | 300 | Display de seção |
| 48px | Fraunces | 300 | Título de página |
| 32px | Fraunces | 300 | Título de seção |
| 22px | Fraunces | 300 | Título de card/componente |
| 16px | Fraunces 300 italic | — | Pull quote |
| 16px | DM Sans | 400 | Corpo principal |
| 14px | DM Sans | 300 | Corpo de documento técnico |
| 13px | DM Sans | 300-400 | Body secundário, descrições de card |
| 11px | JetBrains Mono | 400 | Metadados, labels |
| 10px | JetBrains Mono | 400 | Tags de seção em uppercase |
| 9px | JetBrains Mono | 400 | Mínimo — timestamps, sub-labels |

### Regras de Tipografia

**Nunca bold no meio do corpo.** Hierarquia vem de tamanho, família e cor — não de `font-weight: 700` dentro de um parágrafo.

**Itálico é instrumento de voz.** Fraunces italic muda o "quem fala" dentro de um headline — como a parte cinza das headlines que suaviza a declaração principal.

**Mono em uppercase = label de seção.** `letter-spacing: 0.18em`, `font-size: 10px`, `color: text-muted`. Nunca em tom mais quente — é estrutura, não acento.

**Letter-spacing negativo em display.** Qualquer Fraunces acima de 48px: `letter-spacing: -0.03em` a `-0.04em`. Sem isso parece amateur.

---

## Espaçamento e Layout

### Escala

Base 4px. Progressão: 4, 8, 12, 16, 24, 32, 40, 48, 64, 96, 128.

### Princípios de Layout

**Respiração deliberada, não airy.** Apple usa espaçamento que "flutua". Aqui o espaço é peso — calculado, não decorativo.

**Gaps de 2px entre cards.** Não 16px, não 0. O `gap: 2px` entre superfícies da mesma família cria continuidade sem fundir. É a linguagem de agrupamento do sistema.

**Uma coluna que vaza.** Em layouts de desktop, pelo menos um elemento deve ultrapassar a coluna padrão — um headline que vai até a borda, uma seção que ignora o padding. A grandiosidade precisa de espaço para aparecer.

**Border-radius**

| Contexto | Valor |
|---|---|
| Inputs, badges | 4px |
| Botões, chips | 6-8px |
| Cards, modais | 12px |
| Containers hero | 20px |
| Nunca | 0 ou pill (24px+) |

---

## Textura: Strata

```css
background-image: repeating-linear-gradient(
  180deg,
  transparent,
  transparent 59px,
  rgba(255, 255, 255, 0.012) 60px
);
```

**O que é:** Linhas horizontais quase invisíveis em intervalos de 60px. Sugerem estratos geológicos, camadas de tempo, profundidade sedimentada.

**Onde usar:** Fundos de seção grandes, sidebars, hero backgrounds, dentro de cards em contextos de documento.

**Onde não usar:** Sobre o vermelho de ruptura (o vermelho tem sua própria textura com linhas pretas, mais sutil). Sobre componentes pequenos — some na escala.

**Por que não grain:** Grain é tendência de 2023-24, aplicado por filtro, sem origem. Strata é estrutural, tem ritmo, tem razão de existir.

---

## Bordas e Sombras

### Bordas

```css
/* Separador de seção */
border-top: 1px solid #1A1A22;

/* Borda de componente */
border: 1px solid #252530;

/* Acento de identidade (vermelho) — sempre no topo ou esquerda */
border-top: 2px solid #C42B2B;
border-left: 2px solid #C42B2B;
```

Bordas nunca decoram — elas separam contextos ou marcam identidade.

### Sombras

```css
/* Elevação suave */
box-shadow: 0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03);

/* Elevação média */
box-shadow: 0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04);

/* Calor (vermelho) */
box-shadow: 0 0 24px rgba(196,43,43,0.15);

/* Profundeza (depth) */
box-shadow: 0 0 24px rgba(26,95,173,0.15);
```

Glows usados com extrema parcimônia — máximo um por composição.

---

## Aplicação Cross-Platform

### Interface de Software

- Fundo void com strata
- Superfícies em surface-1/2
- Vermelho: dots de status de identidade, border-top no hover, badges de alerta crítico de identidade
- Depth: dados, barras de progresso, estado nominal, gráficos
- Mono em tudo que é métrico ou estrutural
- Fraunces apenas em títulos de seção — não em labels de UI

### Post de Redes Sociais (1:1 ou 4:5)

Regra: **uma cor, uma frase, uma linha âncora.**

- 90%+ da composição: void + texto
- A única cor visível: vermelho (linha de 2px ou dot)
- Headline em Fraunces 300, branco display (#F8F5EF)
- Parte final em itálico, cinza — a mudança de voz
- Handle e data em Mono, text-muted
- Strata no fundo
- Zero gradiente, zero foto de fundo, zero múltiplas cores

### Documento Técnico (ADR, RFC, Readme)

- Pull quote em Fraunces italic, border-left vermelho (2px)
- Títulos de seção em Fraunces 300
- Labels de seção (tipo "Consequências") em Mono uppercase, text-muted
- Numeração estrutural em Mono, depth blue
- Corpo em DM Sans 300/400, line-height 1.85
- Nunca bold no meio do corpo
- Separadores: 1px solid border-subtle

### Apresentação Técnica

- Slides escuros, void como fundo
- Uma headline por slide — Fraunces em escala grande
- Strata no fundo
- Dados e código em Mono
- Slide de impacto: fundo vermelho inteiro, Fraunces branco (o "Boi aparecendo")
- Máximo 2 cores por slide (void + vermelho, ou void + depth)

---

## Anti-Padrões

**Nunca faça:**

- Ícone de engrenagem para "configurações" — ou qualquer metáfora visual literal
- Gradiente decorativo — gradiente só existe em glows radiais e charts
- Grain overlay — strata apenas
- Amber como acento — foi o erro da v1. Amber é tech genérica.
- Vermelho como cor de erro padrão — vermelho é identidade. Erros usam `warning` (#B87A1A) ou estado semântico separado
- Bold no meio de parágrafos
- Pill shapes (border-radius 24px+)
- Múltiplas famílias de fonte além das três definidas
- Excesso de acentos — máximo 2-3 pontos de cor por composição
- Seções com cor de fundo além do void/surfaces e a ruptura vermelho

---

## O Nome do Sistema

**Abismo Habitado.**

Não é vazio — tem calor. Não é frio — tem raiz. É o espaço entre o cosmos e a fogueira. Entre Interstellar e o Boi Garantido. Entre a profundeza de Subnautica e os tambores de Parintins.

Quando alguém olhar para qualquer coisa feita com esse sistema e sentir "tem mais aqui do que parece" — esse é o objetivo.

---

*Abismo Habitado v1.0 — construído para durar.*
