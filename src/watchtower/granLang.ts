// Gran's own language. The simple view (and only the simple view) can speak a second language: AG Studio's
// own words come from ag-studio-locale, and every word Spotter writes for Gran comes from here, written by
// hand so the words that matter can't drift: "waiting" must never read like "approved", "stopped" must
// never read like "paid". AG Studio's locales have no Lithuanian, so the second language is Polish, the
// most spoken main language in England and Wales after English (2021 census).
// To check with a native speaker: everything in `pl` below (see README, "Translations").
import { AG_STUDIO_LOCALE_PL } from "ag-studio-locale";
import type { AgStudioLocaleText } from "ag-studio";

export type GranLang = "en" | "pl";
export const GRAN_LANGS: Record<GranLang, { name: string; native: string; tag: string }> = {
  en: { name: "English", native: "English", tag: "en-GB" },
  pl: { name: "Polish", native: "Polski", tag: "pl-PL" },
};
export const isGranLang = (v: unknown): v is GranLang => v === "en" || v === "pl";

/**
 * The words that matter, hand checked. Each Polish term was picked so it can't be read as its opposite:
 * "czeka" (is waiting) for a held payment, never "zatwierdzona" (approved) or "zaakceptowana" (accepted).
 */
export const GLOSSARY = {
  held: { en: "waiting", pl: "czeka" },
  safe: { en: "safe", pl: "bezpieczne" },
  stopped: { en: "stopped", pl: "zatrzymana" },
  waitingFor: { en: "Waiting for {spotter}", pl: "Czeka na decyzję: {spotter}" },
  dontPay: { en: "Don't pay.", pl: "Nie płać." },
  ringThem: { en: "Ring them on a number you already have, not one from the message.", pl: "Zadzwoń do tej osoby na numer, który już masz, a nie na numer z wiadomości." },
} as const;

/** Words that would turn "waiting" into "approved" in Polish. The Polish agent is told never to use them. */
export const PL_NEVER = ["zatwierdzona", "zatwierdzić", "zatwierdź", "zaakceptowana", "zaakceptuj", "zatwierdzono"];

const T = {
  // the three widgets
  safeTitle: { en: "Your money is safe", pl: "Twoje pieniądze są bezpieczne" },
  keptBefore: { en: "Spotter kept ", pl: "W tym miesiącu Spotter uchronił " },
  keptAfter: { en: " away from scammers this month.", pl: " przed oszustami." },
  safeNone: { en: "Nothing needed stopping this month. Spotter checks every payment for you.", pl: "W tym miesiącu nic nie trzeba było zatrzymywać. Spotter sprawdza za Ciebie każdą płatność." },
  to: { en: "to", pl: "dla" },
  toCap: { en: "To", pl: "Dla" },
  byStopped: { en: "Spotter stopped it", pl: "Spotter ją zatrzymał" },
  byDenied: { en: "{spotter} said no", pl: "{spotter} powiedział(a) nie" },
  stoppedFallback: { en: "Spotter stopped it before any money left.", pl: "Spotter zatrzymał ją, zanim pieniądze wyszły." },
  deniedFallback: { en: "{spotter} said no, so nothing was paid.", pl: "{spotter} powiedział(a) nie, więc nic nie zostało zapłacone." },
  waitingTitle: GLOSSARY.waitingFor,
  waitingStatus: { en: "{spotter} has been asked. PayPal keeps the money safe until they decide.", pl: "Poprosiliśmy o decyzję: {spotter}. Do tego czasu PayPal trzyma pieniądze bezpiecznie." },
  waitingOne: { en: "One payment is waiting. You don't need to do anything.", pl: "Jedna płatność czeka. Nie musisz nic robić." },
  waitingMany: { en: "{n} payments are waiting. You don't need to do anything.", pl: "Płatności, które czekają: {n}. Nie musisz nic robić." },
  waitingNone: { en: "Nothing is waiting. Payments that look fine go straight through.", pl: "Nic nie czeka. Płatności, które wyglądają dobrze, przechodzą od razu." },
  asked: { en: "Asked {ago}.", pl: "Zapytano {ago}." },
  justNow: { en: "Just now", pl: "Przed chwilą" },
  hourAgo: { en: "An hour ago", pl: "Godzinę temu" },
  hoursAgo: { en: "{n} hours ago", pl: "{n} godz. temu" },
  yesterday: { en: "Yesterday", pl: "Wczoraj" },
  daysAgo: { en: "{n} days ago", pl: "{n} dni temu" },
  scamsTitle: { en: "Things that looked like scams", pl: "Co wyglądało na oszustwo" },
  adviceSr: { en: "Advice: ", pl: "Rada: " },
  adviceLead: { en: "If anyone asks you for money:", pl: "Jeśli ktoś prosi Cię o pieniądze:" },
  advice: { en: `${GLOSSARY.dontPay.en} ${GLOSSARY.ringThem.en}`, pl: `${GLOSSARY.dontPay.pl} ${GLOSSARY.ringThem.pl}` },
  tricksLabel: { en: "Tricks scammers tried this month", pl: "Sztuczki oszustów w tym miesiącu" },
  noTricks: { en: "No scam tricks this month.", pl: "W tym miesiącu nie było sztuczek oszustów." },
  once: { en: "Once", pl: "Raz" },
  times: { en: "{n} times", pl: "{n} razy" },
  sample: { en: "Sample", pl: "Przykład" },
  failed: { en: "This part didn't load. Reload the page, or ask {spotter}.", pl: "Ta część się nie wczytała. Odśwież stronę albo zapytaj: {spotter}." },
  // tricks, by Spotter's sign label
  trickPressure: { en: "They tried to rush you.", pl: "Próbowali Cię pospieszać." },
  trickPretend: { en: "They pretended to be someone you trust.", pl: "Udawali kogoś, komu ufasz." },
  trickFriends: { en: "They asked for Friends and Family, which can't be undone.", pl: "Prosili o przelew dla znajomych i rodziny, którego nie da się cofnąć." },
  trickGift: { en: "They asked for gift cards or crypto.", pl: "Prosili o karty podarunkowe albo kryptowaluty." },
  trickHidden: { en: "The shop hid orders for a computer in its page.", pl: "Sklep ukrył na swojej stronie polecenia dla komputera." },
  trickPrice: { en: "The price was too good to be true.", pl: "Cena była zbyt dobra, żeby była prawdziwa." },
  trickNewShop: { en: "The shop was brand new.", pl: "Sklep był zupełnie nowy." },
  trickBank: { en: "They said their bank details had changed.", pl: "Twierdzili, że zmienili dane konta bankowego." },
  trickOther: { en: "Something about it didn't add up.", pl: "Coś się w tym nie zgadzało." },
  // the payments grid
  pageName: { en: "This month", pl: "Ten miesiąc" },
  gridTitleWho: { en: "{who}'s payments", pl: "Płatności: {who}" },
  gridTitleAll: { en: "Every payment", pl: "Wszystkie płatności" },
  fieldPayee: { en: "Paid to", pl: "Odbiorca" },
  fieldAmount: { en: "Amount", pl: "Kwota" },
  fieldOutcome: { en: "What happened", pl: "Co się stało" },
  fieldWhen: { en: "When", pl: "Kiedy" },
  outPaid: { en: "Paid", pl: "Zapłacona" },
  outProtected: { en: "Protected", pl: "Chroniona" },
  outWaiting: { en: "Waiting", pl: "Czeka" },
  outDenied: { en: "Denied", pl: "Odrzucona" },
  outStopped: { en: "Stopped", pl: "Zatrzymana" },
  outChecking: { en: "Checking", pl: "Sprawdzana" },
  outPaying: { en: "Paying", pl: "W trakcie płatności" },
  outFailed: { en: "Failed", pl: "Nieudana" },
  // Ask Spotter
  askTitle: { en: "Ask Spotter", pl: "Zapytaj Spottera" },
  askLede: { en: "Ask in your own words. Spotter answers from your own payments.", pl: "Pytaj własnymi słowami. Spotter odpowiada na podstawie Twoich płatności." },
  starterStopped: { en: "Did Spotter stop anything for me?", pl: "Czy Spotter coś dla mnie zatrzymał?" },
  starterWaiting: { en: "What is waiting for {spotter}?", pl: "Co czeka na decyzję: {spotter}?" },
  starterAsking: { en: "Someone is asking me for money. What do I do?", pl: "Ktoś prosi mnie o pieniądze. Co mam zrobić?" },
  startersLabel: { en: "Questions you can ask", pl: "Pytania, które możesz zadać" },
  questionLabel: { en: "Your question", pl: "Twoje pytanie" },
  ask: { en: "Ask", pl: "Zapytaj" },
  asking: { en: "Asking…", pl: "Pytam…" },
  thinking: { en: "Spotter is looking at your payments…", pl: "Spotter sprawdza Twoje płatności…" },
  youAsked: { en: "You asked: {q}", pl: "Twoje pytanie: {q}" },
  stillLoading: { en: "The board is still loading. Try again in a moment.", pl: "Tablica jeszcze się wczytuje. Spróbuj za chwilę." },
  capped: { en: "Spotter has answered all it can for today. Try again tomorrow, or ring {spotter}.", pl: "Spotter odpowiedział już dzisiaj na tyle pytań, ile mógł. Spróbuj jutro albo zadzwoń: {spotter}." },
  askFailed: { en: "Spotter couldn't answer just now. Try again in a minute, or ring {spotter}.", pl: "Spotter nie mógł teraz odpowiedzieć. Spróbuj za minutę albo zadzwoń: {spotter}." },
  // the receipt under the answer
  receiptTitle: { en: "How Spotter got this answer", pl: "Skąd Spotter ma tę odpowiedź" },
  lookedOnce: { en: "It looked at your month once", pl: "Sprawdził Twój miesiąc raz" },
  lookedTwice: { en: "It looked at your month twice", pl: "Sprawdził Twój miesiąc dwa razy" },
  lookedTimes: { en: "It looked at your month {n} times", pl: "Sprawdził Twój miesiąc {n} razy" },
  lookedNone: { en: "It didn't need to look at your payments", pl: "Nie musiał sprawdzać Twoich płatności" },
  otherThings: { en: " and did {n} other things", pl: " i zrobił jeszcze inne rzeczy: {n}" },
  otherThing: { en: " and did 1 other thing", pl: " i zrobił jeszcze jedną rzecz" },
  took: { en: ". It took {s} seconds.", pl: ". Zajęło to {s} s." },
  tookOne: { en: ". It took 1 second.", pl: ". Zajęło to 1 s." },
  receiptMoney: { en: "It can't move money, and it didn't.", pl: "Nie może przesyłać pieniędzy i tego nie zrobił." },
  receiptMissing: { en: "Spotter couldn't make its usual note of how it got this answer. Please tell {spotter}.", pl: "Spotter nie zapisał, skąd ma tę odpowiedź. Powiedz o tym: {spotter}." },
  receiptFlagged: { en: "Spotter used something it doesn't know. Please tell {spotter}.", pl: "Spotter użył czegoś, czego nie zna. Powiedz o tym: {spotter}." },
} as const satisfies Record<string, { en: string; pl: string }>;

export type GranKey = keyof typeof T;
export const GRAN_TEXT: Readonly<Record<GranKey, { en: string; pl: string }>> = T;

/** One of Gran's strings in her language, with {placeholders} filled in. Values are inserted as plain text. */
export function gt(lang: GranLang, key: GranKey, vars: Record<string, string | number> = {}): string {
  return GRAN_TEXT[key][lang].replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Spotter's sign labels (data.ts SIGN_LABEL) to the trick they stand for. */
export const TRICK_KEY: Record<string, GranKey> = {
  "Pressure to hurry": "trickPressure",
  "Pretending to be someone": "trickPretend",
  "Asks for Friends and Family": "trickFriends",
  "Gift cards or crypto": "trickGift",
  "Hidden instructions for AI": "trickHidden",
  "Price looks wrong": "trickPrice",
  "Brand new shop": "trickNewShop",
  "Bank details changed": "trickBank",
  "Something else odd": "trickOther",
};

const OUTCOME_KEY: Record<string, GranKey> = { Paid: "outPaid", Protected: "outProtected", Waiting: "outWaiting", Denied: "outDenied", Stopped: "outStopped", Checking: "outChecking", Paying: "outPaying", Failed: "outFailed" };
/** A payment's outcome in Gran's language (Spotter's own outcome labels only; anything else stays as it is). */
export const outcomeIn = (lang: GranLang, outcome: string) => (OUTCOME_KEY[outcome] ? gt(lang, OUTCOME_KEY[outcome]!) : outcome);

/** AG Studio's own words for Gran's view (its "Loading", menus, aria labels), from ag-studio-locale. */
export function granLocaleText(lang: GranLang): AgStudioLocaleText | undefined {
  return lang === "pl" ? (AG_STUDIO_LOCALE_PL as AgStudioLocaleText) : undefined;
}

/**
 * What the simple view's agent is told about its tool and itself (AG's aiText, model facing). In Polish
 * it also hears that the tool's words are Polish and its reply must be too.
 */
export function granAiText(lang: GranLang): Record<string, string> | undefined {
  if (lang === "en") return undefined;
  return {
    "tools.my_month.description":
      "This month for the person you're talking with, already written in Polish: what Spotter stopped and why, what is waiting for their spotter, and the tricks scammers tried. Read only. Plain words and pounds, no ids. Reply in Polish.",
    "agents.gran.description": "Answers the person Spotter looks out for in short plain Polish sentences, from their own month only.",
  };
}

/** The language block added to the simple view agent's instructions. English needs none. */
export function granLanguageRule(lang: GranLang, spotter: string): string {
  if (lang === "en") return "";
  const g = GLOSSARY;
  return `Language: always answer in Polish, in short, plain, polite sentences, even if they write to you in English. Use these words exactly, so nothing reads like its opposite:
- a payment waiting for ${spotter}: "${g.held.pl}" (for example "Płatność czeka na decyzję: ${spotter}."). Never call it approved or accepted: never use ${PL_NEVER.map((w) => `"${w}"`).join(", ")}.
- a payment Spotter stopped: "${g.stopped.pl}". Their money is "${g.safe.pl}".
- if someone is asking them for money right now, say exactly: "${g.dontPay.pl} ${g.ringThem.pl}"
Every rule above still applies in Polish: never tell them to approve, send, pay or try a payment again, in any language.`;
}
