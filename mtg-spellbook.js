const STORAGE_KEY = "mtg-spellbook-state";

const state = loadState();

const searchForm = document.querySelector("#card-search-form");
const searchInput = document.querySelector("#card-search-input");
const cardResult = document.querySelector("#card-result");
const deckForm = document.querySelector("#deck-form");
const deckSummary = document.querySelector("#deck-summary");
const suggestionList = document.querySelector("#suggestion-list");

searchForm.addEventListener("submit", handleCardSearch);
deckForm.addEventListener("submit", handleDeckBuild);
document.querySelector("#use-last-card").addEventListener("click", handleUseLastCard);
document.querySelectorAll('.color-fieldset input[type="checkbox"]').forEach((input) => {
  input.addEventListener("change", applyDeckThemeFromForm);
});

hydrateDeckForm();
applyDeckTheme(state.deck.colors);
renderDeckSummary();
renderSuggestions();
renderLastCard();

async function handleCardSearch(event) {
  event.preventDefault();
  const query = searchInput.value.trim();

  if (!query) {
    return;
  }

  cardResult.className = "card-result loading-state";
  cardResult.textContent = "Searching Scryfall...";

  try {
    const card = await fetchCard(query);
    state.lastCard = simplifyCard(card);
    persist();
    renderLastCard();
  } catch (error) {
    cardResult.className = "card-result empty-state";
    cardResult.textContent = error.message || "Could not find that card.";
  }
}

function handleDeckBuild(event) {
  event.preventDefault();
  state.deck = {
    colors: getSelectedColors(),
    strategy: document.querySelector("#deck-strategy").value,
    goal: document.querySelector("#deck-goal").value.trim(),
    mustPlay: splitItems(document.querySelector("#must-play").value)
  };

  persist();
  applyDeckTheme(state.deck.colors);
  renderDeckSummary();
  renderSuggestions();
}

function handleUseLastCard() {
  if (!state.lastCard?.name) {
    return;
  }

  const textarea = document.querySelector("#must-play");
  const items = uniqueItems([...splitItems(textarea.value), state.lastCard.name]);
  textarea.value = items.join(", ");
}

function renderLastCard() {
  const card = state.lastCard;

  if (!card) {
    cardResult.className = "card-result empty-state";
    cardResult.textContent = "Search a Magic card to see its oracle text, plain-English explanation, and deck role.";
    return;
  }

  const explanation = explainCard(card);
  const interactions = describeInteractions(card);

  cardResult.className = "card-result";
  cardResult.innerHTML = `
    <article class="card-result__layout">
      <div class="card-result__media">
        ${card.image
          ? `<img src="${escapeAttribute(card.image)}" alt="${escapeAttribute(card.name)}">`
          : `<div class="card-fallback">No image</div>`}
      </div>
      <div class="card-result__content">
        <span class="eyebrow">Card breakdown</span>
        <h3>${escapeHtml(card.name)}</h3>
        <p class="card-meta">${escapeHtml(card.manaCost || "No mana cost")} • ${escapeHtml(card.typeLine || "Unknown type")}</p>
        <p><span class="inline-label">Oracle text:</span> ${escapeHtml(card.oracleText || "No oracle text available.")}</p>
        <p><span class="inline-label">Plain English:</span> ${escapeHtml(explanation.summary)}</p>
        <ul class="info-list">
          <li><span>Role:</span> ${escapeHtml(explanation.role)}</li>
          <li><span>What to watch for:</span> ${escapeHtml(explanation.watchFor)}</li>
          <li><span>Likely interactions:</span> ${escapeHtml(interactions)}</li>
        </ul>
      </div>
    </article>
  `;
}

function renderDeckSummary() {
  const deck = state.deck;

  if (!deck.colors.length && !deck.mustPlay.length && !deck.goal) {
    deckSummary.className = "deck-summary empty-state";
    deckSummary.textContent = "Choose colors, a strategy, and a few anchor cards to generate recommendations.";
    return;
  }

  deckSummary.className = "deck-summary";
  deckSummary.innerHTML = `
    <strong>${escapeHtml(describeColors(deck.colors))} ${escapeHtml(titleCase(deck.strategy))} deck</strong>
    <p>${escapeHtml(deck.goal || "No deck goal written yet.")}</p>
    <p><span class="inline-label">Must-play cards:</span> ${escapeHtml(deck.mustPlay.length ? deck.mustPlay.join(", ") : "None yet")}</p>
  `;
}

function renderSuggestions() {
  const suggestions = buildSuggestions();

  suggestionList.className = "suggestion-list";
  suggestionList.innerHTML = suggestions.length
    ? suggestions.map((item) => `
        <article class="suggestion-card">
          <div class="suggestion-card__top">
            <div>
              <span class="eyebrow">${escapeHtml(item.bucket)}</span>
              <h3>${escapeHtml(item.name)}</h3>
            </div>
            <strong>${escapeHtml(item.fit)}</strong>
          </div>
          <p>${escapeHtml(item.reason)}</p>
          <p><span class="inline-label">Why it fits:</span> ${escapeHtml(item.detail)}</p>
        </article>
      `).join("")
    : '<div class="empty-state">No suggestions yet. Build a deck plan to see recommended cards.</div>';
}

async function fetchCard(query) {
  const response = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(query)}`);

  if (!response.ok) {
    throw new Error("Card not found. Try a closer card name.");
  }

  return response.json();
}

function simplifyCard(card) {
  return {
    name: card.name,
    manaCost: card.mana_cost,
    typeLine: card.type_line,
    oracleText: card.oracle_text,
    colors: card.color_identity || [],
    image: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || "",
    keywords: Array.isArray(card.keywords) ? card.keywords : []
  };
}

function explainCard(card) {
  const text = (card.oracleText || "").toLowerCase();
  const typeLine = (card.typeLine || "").toLowerCase();

  let role = "Flexible support piece";
  let watchFor = "Check timing, mana cost, and whether the effect needs setup.";

  if (text.includes("draw")) {
    role = "Card advantage";
  } else if (text.includes("destroy") || text.includes("exile target")) {
    role = "Removal";
  } else if (text.includes("create") && text.includes("token")) {
    role = "Board builder";
  } else if (text.includes("add") && text.includes("{")) {
    role = "Ramp or mana fixing";
  } else if (typeLine.includes("instant")) {
    role = "Reactive spell";
  } else if (typeLine.includes("equipment")) {
    role = "Combat support";
  }

  if (text.includes("whenever")) {
    watchFor = "This card wants repeated triggers, so it gets better when you can make the same thing happen over and over.";
  } else if (text.includes("at the beginning")) {
    watchFor = "This card pays you over time, so protect it long enough to get multiple turns from it.";
  } else if (text.includes("sacrifice")) {
    watchFor = "Make sure your deck actually has expendable permanents or this effect becomes clunky.";
  }

  return {
    role,
    watchFor,
    summary: toPlainEnglish(card)
  };
}

function toPlainEnglish(card) {
  const text = card.oracleText || "";

  if (!text) {
    return "This card has no rules text to translate.";
  }

  return text
    .replaceAll("enters the battlefield", "comes into play")
    .replaceAll("dies", "is put into the graveyard from the battlefield")
    .replaceAll("mana value", "converted cost")
    .replaceAll("you may", "you can choose to")
    .replaceAll("create", "make")
    .replaceAll("opponent", "the other player")
    .replaceAll("Whenever", "Every time")
    .replaceAll("At the beginning of", "At the start of")
    .replaceAll("until end of turn", "for the rest of this turn");
}

function describeInteractions(card) {
  const text = (card.oracleText || "").toLowerCase();
  const keywords = card.keywords.join(", ").toLowerCase();

  if (text.includes("token")) {
    return "Pairs well with token doublers, anthem effects, and sacrifice outlets.";
  }
  if (text.includes("draw")) {
    return "Works well with effects that reward casting spells or keeping mana open.";
  }
  if (text.includes("equip")) {
    return "Gets better with creatures that want haste, protection, or combat triggers.";
  }
  if (keywords.includes("flash")) {
    return "Plays best in reactive decks that pass with mana open.";
  }
  return "Look for cards that repeat this effect, reduce its cost, or reward the same game action.";
}

function buildSuggestions() {
  const deck = state.deck;
  const profile = getStrategyProfile(deck.strategy);
  const anchors = deck.mustPlay.map((name) => name.toLowerCase());
  const colorSet = new Set(deck.colors);

  if (!deck.colors.length && !deck.mustPlay.length && !deck.goal) {
    return [];
  }

  return profile.cards
    .filter((card) => fitsColors(card.colors, colorSet))
    .filter((card) => !anchors.includes(card.name.toLowerCase()))
    .map((card) => {
      const namedSynergy = card.tags.some((tag) => anchors.some((anchor) => anchor.includes(tag)));
      return {
        name: card.name,
        bucket: card.bucket,
        fit: namedSynergy ? "High synergy" : "Strong fit",
        reason: namedSynergy
          ? `This lines up especially well with at least one of your must-play cards.`
          : `This supports a ${titleCase(deck.strategy)} plan in ${describeColors(deck.colors)}.`,
        detail: card.detail
      };
    })
    .slice(0, 8);
}

function getStrategyProfile(strategy) {
  const profiles = {
    tokens: {
      cards: [
        cardSuggestion("Anointed Procession", ["W"], "Engine", "Doubles your token output and makes every token maker much scarier.", ["token", "procession"]),
        cardSuggestion("Mondrak, Glory Dominus", ["W"], "Engine", "Another token doubler that also becomes harder to remove.", ["token", "mondrak"]),
        cardSuggestion("Skullclamp", [], "Card draw", "Turns small creature tokens into card draw so your board keeps refilling.", ["token", "sacrifice"]),
        cardSuggestion("Beastmaster Ascension", ["G"], "Finisher", "Rewards going wide and helps a token board end the game quickly.", ["token", "go wide"])
      ]
    },
    control: {
      cards: [
        cardSuggestion("Cyclonic Rift", ["U"], "Reset button", "Buys time and clears the way while leaving your own board alone.", ["control", "tempo"]),
        cardSuggestion("Swords to Plowshares", ["W"], "Removal", "Cheap clean removal that answers major threats efficiently.", ["removal"]),
        cardSuggestion("Rhystic Study", ["U"], "Card draw", "Keeps cards flowing while making opponents play awkwardly.", ["draw", "tax"]),
        cardSuggestion("Farewell", ["W"], "Sweeper", "Flexible mass removal that solves several types of boards at once.", ["sweeper"])
      ]
    },
    aggro: {
      cards: [
        cardSuggestion("Lightning Greaves", [], "Protection", "Protects your best threat and gives immediate pressure with haste.", ["combat", "haste"]),
        cardSuggestion("Heroic Reinforcements", ["R", "W"], "Burst damage", "Adds bodies and pushes an alpha strike.", ["combat", "token"]),
        cardSuggestion("Embercleave", ["R"], "Finisher", "Turns any good attack into a lethal attack fast.", ["combat", "equipment"]),
        cardSuggestion("Adeline, Resplendent Cathar", ["W"], "Pressure", "Builds a board while attacking hard every turn.", ["combat", "token"])
      ]
    },
    ramp: {
      cards: [
        cardSuggestion("Cultivate", ["G"], "Ramp", "Smooths your mana while helping you hit bigger plays sooner.", ["ramp"]),
        cardSuggestion("Kodama's Reach", ["G"], "Ramp", "Another dependable ramp piece that keeps land drops coming.", ["ramp"]),
        cardSuggestion("Solemn Simulacrum", [], "Value", "Fixes mana early and replaces itself later.", ["ramp", "value"]),
        cardSuggestion("Nyxbloom Ancient", ["G"], "Explosion", "Turns any stable mana base into a huge late-game jump.", ["ramp", "big mana"])
      ]
    },
    graveyard: {
      cards: [
        cardSuggestion("Entomb", ["B"], "Setup", "Puts exactly the right card into the graveyard to fuel your plan.", ["graveyard"]),
        cardSuggestion("Reanimate", ["B"], "Payoff", "Turns your graveyard into direct board presence efficiently.", ["graveyard", "reanimate"]),
        cardSuggestion("Satyr Wayfinder", ["G"], "Filler", "Loads the graveyard while helping you hit lands.", ["graveyard", "mill"]),
        cardSuggestion("Living Death", ["B"], "Swing card", "Can completely reverse a stalled board if your graveyard is fuller.", ["graveyard", "sweeper"])
      ]
    },
    lifegain: {
      cards: [
        cardSuggestion("Soul Warden", ["W"], "Enabler", "Turns creature-heavy games into repeated life triggers.", ["lifegain"]),
        cardSuggestion("Ajani's Pridemate", ["W"], "Payoff", "Converts steady life gain into a growing threat.", ["lifegain", "counters"]),
        cardSuggestion("Dina, Soul Steeper", ["B", "G"], "Drain payoff", "Turns life gain into pressure on opponents too.", ["lifegain", "drain"]),
        cardSuggestion("Well of Lost Dreams", [], "Card draw", "Lets your life gain turn into cards if you have mana to spare.", ["lifegain", "draw"])
      ]
    },
    spells: {
      cards: [
        cardSuggestion("Young Pyromancer", ["R"], "Payoff", "Turns every instant and sorcery into extra board presence.", ["spells", "token"]),
        cardSuggestion("Storm-Kiln Artist", ["R"], "Engine", "Gives you mana while you keep chaining noncreature spells.", ["spells", "treasure"]),
        cardSuggestion("Archmage Emeritus", ["U"], "Card draw", "Rewards casting spells by refilling your hand.", ["spells", "draw"]),
        cardSuggestion("Past in Flames", ["R"], "Recursion", "Lets a big graveyard of spells become another explosive turn.", ["spells", "graveyard"])
      ]
    },
    artifacts: {
      cards: [
        cardSuggestion("Sai, Master Thopterist", ["U"], "Payoff", "Turns artifact casting into bodies and late-game cards.", ["artifact", "token"]),
        cardSuggestion("Foundry Inspector", [], "Cost reduction", "Makes your whole artifact curve smoother.", ["artifact", "cost"]),
        cardSuggestion("Academy Manufactor", [], "Value engine", "Supercharges treasure, clue, and food production.", ["artifact", "token"]),
        cardSuggestion("Dispatch", ["W"], "Removal", "Becomes extremely efficient once your artifact count is high enough.", ["artifact", "removal"])
      ]
    },
    counters: {
      cards: [
        cardSuggestion("Hardened Scales", ["G"], "Engine", "Every counter placement gets more efficient.", ["counter"]),
        cardSuggestion("Branching Evolution", ["G"], "Multiplier", "Doubles your +1/+1 counter growth on creatures.", ["counter"]),
        cardSuggestion("Conclave Mentor", ["G", "W"], "Support", "Adds extra counters and pads your life total.", ["counter", "lifegain"]),
        cardSuggestion("The Ozolith", [], "Insurance", "Helps your counters survive removal and keep moving.", ["counter"])
      ]
    },
    sacrifice: {
      cards: [
        cardSuggestion("Viscera Seer", ["B"], "Outlet", "Free sacrifice outlet that also smooths your draws.", ["sacrifice"]),
        cardSuggestion("Mayhem Devil", ["B", "R"], "Payoff", "Turns every sacrifice into damage and board pressure.", ["sacrifice", "damage"]),
        cardSuggestion("Pitiless Plunderer", ["B"], "Engine", "Pays you in treasure when your creatures die.", ["sacrifice", "treasure"]),
        cardSuggestion("Blood Artist", ["B"], "Drain payoff", "Makes your creature trading and sacrifice loops hurt opponents.", ["sacrifice", "lifegain"])
      ]
    }
  };

  return profiles[strategy] || profiles.tokens;
}

function cardSuggestion(name, colors, bucket, detail, tags) {
  return { name, colors, bucket, detail, tags };
}

function fitsColors(cardColors, selectedColors) {
  if (!selectedColors.size) {
    return true;
  }

  return cardColors.every((color) => selectedColors.has(color));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      lastCard: saved?.lastCard || null,
      deck: {
        colors: Array.isArray(saved?.deck?.colors) ? saved.deck.colors : [],
        strategy: saved?.deck?.strategy || "tokens",
        goal: saved?.deck?.goal || "",
        mustPlay: Array.isArray(saved?.deck?.mustPlay) ? saved.deck.mustPlay : []
      }
    };
  } catch {
    return {
      lastCard: null,
      deck: {
        colors: [],
        strategy: "tokens",
        goal: "",
        mustPlay: []
      }
    };
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function hydrateDeckForm() {
  document.querySelector("#deck-strategy").value = state.deck.strategy;
  document.querySelector("#deck-goal").value = state.deck.goal;
  document.querySelector("#must-play").value = state.deck.mustPlay.join(", ");

  document.querySelectorAll('.color-fieldset input[type="checkbox"]').forEach((input) => {
    input.checked = state.deck.colors.includes(input.value);
  });
}

function applyDeckThemeFromForm() {
  applyDeckTheme(getSelectedColors());
}

function applyDeckTheme(colors) {
  const activeColors = normalizeColorOrder(Array.isArray(colors) ? colors : []);
  document.body.dataset.colors = activeColors.join("");
}

function getSelectedColors() {
  return [...document.querySelectorAll('.color-fieldset input[type="checkbox"]:checked')].map((input) => input.value);
}

function splitItems(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueItems(items) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function normalizeColorOrder(colors) {
  const order = ["W", "U", "B", "R", "G"];
  return [...colors].sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

function describeColors(colors) {
  if (!colors.length) {
    return "Color-flexible";
  }

  const names = {
    W: "White",
    U: "Blue",
    B: "Black",
    R: "Red",
    G: "Green"
  };

  return colors.map((color) => names[color]).join(" / ");
}

function titleCase(value) {
  return String(value).replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
