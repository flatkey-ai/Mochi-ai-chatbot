/**
 * Built-in bot replies (the few things Mochi says without calling a model) in the user's language.
 * Everything else the bot says comes from the model, which already replies in the user's language.
 */
export type Lang = "en" | "pt" | "ja" | "zh";

const KANA = /[぀-ヿ]/;
const HAN = /[㐀-䶿一-鿿]/;
const PT = /\b(você|voce|não|nao|obrigad[oa]|olá|ola|tudo bem|por favor|está|estou|quero|preciso|ajuda|me esquece|esqueça|tchau)\b|[ãõç]/i;

export function detectLang(text: string): Lang {
  if (KANA.test(text)) return "ja";
  if (HAN.test(text)) return "zh";
  if (PT.test(text)) return "pt";
  return "en";
}

const REPLIES: Record<"forgot" | "asleep" | "budget" | "glitch", Record<Lang, string>> = {
  forgot: {
    en: "done — i've forgotten everything i knew about you, {name}. fresh start ✨",
    pt: "pronto — esqueci tudo o que sabia sobre você, {name}. recomeço ✨",
    ja: "了解！{name} さんについて覚えていたことは全部忘れたよ。また一からよろしくね ✨",
    zh: "好啦，关于 {name} 的记忆我已经全部清空了，重新开始吧 ✨",
  },
  asleep: {
    en: "i'm not awake yet (˘ω˘) my admin needs to bind a Flatkey API key in my dashboard first!",
    pt: "ainda não acordei (˘ω˘) meu admin precisa vincular uma chave de API Flatkey no meu painel primeiro!",
    ja: "まだ起きてないの (˘ω˘) 管理者さんがダッシュボードで Flatkey API キーを連携してくれたら動けるよ！",
    zh: "我还没睡醒 (˘ω˘) 需要管理员先在控制台绑定 Flatkey API 密钥哦！",
  },
  budget: {
    en: "i'm all out of energy for today (daily budget reached) — catch you tomorrow! 💤",
    pt: "fiquei sem energia por hoje (limite diário atingido) — até amanhã! 💤",
    ja: "今日はもう電池切れ…（1日の予算に到達）また明日ね！💤",
    zh: "今天的电量用完啦（已达每日预算），明天见！💤",
  },
  glitch: {
    en: "oops, my brain glitched for a sec (╥﹏╥) try again?",
    pt: "ops, meu cérebro travou por um segundo (╥﹏╥) tenta de novo?",
    ja: "あれ、ちょっと頭がフリーズしちゃった (╥﹏╥) もう一回送ってくれる？",
    zh: "哎呀，脑子卡了一下 (╥﹏╥) 再发一次试试？",
  },
};

export function builtinReply(kind: keyof typeof REPLIES, userText: string, vars: Record<string, string> = {}): string {
  const s = REPLIES[kind][detectLang(userText)];
  return s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

/** "Forget me" in English, Portuguese, Japanese and Chinese. */
export const FORGET_ME =
  /\b(forget me|forget about me|delete my (data|memory))\b|\b(me esquece|esqueça-me|esqueca-me|apague (meus dados|minha memória))\b|忘了我|忘记我|删除我的(记忆|数据)|私のこと(を)?忘れて|私を忘れて/i;
