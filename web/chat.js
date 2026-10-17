// The chat box: lines from everyone on the planet, and a place to type your own. Text only, in any
// language; the rules (no links, no wallet addresses, 140 characters) are in chat-rules.js, which the
// multiplayer room applies too. Lines are put on the page as text, never as HTML.
import { cleanChat } from "./chat-rules.js";

const KEEP = 40; // lines kept on screen
const FADE_MS = 25_000; // a line fades from the box after this, unless the chat is open
const MUTED_KEY = "courier:chat:muted";
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/// `net`: the multiplayer client (chat, bubble). `toast(text, kind)` shows a short message. `me()` is the
/// logged-in wallet and `myName()` your @handle if you've claimed one, so your own lines from earlier
/// visits read "You" too.
export function createChat(net, { toast, me = () => null, myName = () => null }) {
  const $ = (id) => document.getElementById(id);
  const box = $("chat"), log = $("chatLog"), form = $("chatForm"), input = $("chatInput"), hint = $("chatOpen");
  const touch = matchMedia("(hover: none), (max-width: 640px)").matches;
  hint.textContent = touch ? "💬 Tap to chat" : "💬 Press Enter to chat";
  let enabled = true, lastSent = "";
  let muted = new Set();
  try { muted = new Set(JSON.parse(localStorage.getItem(MUTED_KEY)) ?? []); } catch {}

  // Players with a wallet are muted by address; guests only for this visit.
  const muteKey = (l) => (l.name === "Guest" ? `guest:${l.id}` : l.name.toLowerCase());
  const saveMuted = () => {
    try { localStorage.setItem(MUTED_KEY, JSON.stringify([...muted])); } catch {}
  };

  function line(l) {
    const mine = l.mine || (!!me() && l.name.toLowerCase() === short(me()).toLowerCase()) || (!!myName() && l.name === myName());
    const row = document.createElement("div");
    row.className = "line";
    row.dataset.key = muteKey(l);
    const who = document.createElement("button");
    who.type = "button";
    who.className = mine ? "who me" : "who";
    who.textContent = mine ? "You" : l.name;
    if (!mine) who.title = "Mute";
    who.addEventListener("click", () => {
      if (mine || !confirm(`Mute ${l.name}? You won't see their messages any more.`)) return;
      muted.add(muteKey(l));
      saveMuted();
      for (const r of log.querySelectorAll(".line")) if (r.dataset.key === muteKey(l)) r.remove();
    });
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = l.text;
    row.append(who, text);
    log.append(row);
    while (log.children.length > KEEP) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    const age = Date.now() - l.time;
    if (age >= FADE_MS) row.classList.add("old");
    else setTimeout(() => row.classList.add("old"), FADE_MS - age);
  }

  function open() {
    if (!enabled) return;
    box.classList.add("open");
    form.hidden = false;
    hint.hidden = true;
    input.focus();
    log.scrollTop = log.scrollHeight;
  }
  function close() {
    box.classList.remove("open");
    form.hidden = true;
    hint.hidden = false;
    input.blur();
  }

  // On a phone the keyboard covers the lower half of the screen. While typing, keep the box just above it
  // (the visual viewport is the part you can still see), with the latest lines right over the field.
  const vv = window.visualViewport;
  function fit() {
    const typing = touch && vv && box.classList.contains("open") && document.activeElement === input;
    if (!typing) {
      box.style.top = box.style.bottom = log.style.maxHeight = "";
      return;
    }
    const visibleBottom = vv.offsetTop + vv.height;
    box.style.top = "auto";
    box.style.bottom = `${Math.max(8, innerHeight - visibleBottom + 8)}px`;
    log.style.maxHeight = `${Math.max(40, Math.min(220, vv.height - form.offsetHeight - 100))}px`;
    log.scrollTop = log.scrollHeight;
  }
  vv?.addEventListener("resize", fit);
  vv?.addEventListener("scroll", fit);
  // The keyboard slides in (and out) after focus changes; fit again once it has.
  for (const ev of ["focus", "blur"]) input.addEventListener(ev, () => [0, 150, 400].forEach((ms) => setTimeout(fit, ms)));

  hint.addEventListener("click", open);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const r = cleanChat(input.value);
    if (r.error) {
      if (input.value.trim()) toast(r.error, "error");
      else if (!touch) close();
      return;
    }
    if (!net.chat(r.text)) return toast("Not connected to the other players yet. Try again in a moment.", "error");
    lastSent = r.text;
    input.value = "";
    if (!touch) close(); // back to walking on a keyboard; on a phone the box stays open
  });

  return {
    open,
    close,
    get isOpen() { return box.classList.contains("open"); },
    /// Whether a line from `l` ({ id, name }) would be shown (chat on, not muted): for what's said to Frenpet World's pets.
    allows: (l) => enabled && !muted.has(muteKey(l)),
    /// A new line from the room: shown in the box and as a bubble over whoever said it.
    add(l) {
      if (!enabled || muted.has(muteKey(l))) return;
      line(l);
      net.bubble(l.id, l.text);
    },
    /// The lines from before you arrived (no bubbles).
    history(lines) {
      log.replaceChildren();
      for (const l of lines) if (!muted.has(muteKey(l))) line(l);
    },
    /// The room refused your last line: say why, and give it back to edit.
    error(why) {
      toast(why, "error");
      if (!input.value && lastSent) input.value = lastSent;
    },
    setEnabled(on) {
      enabled = on;
      box.hidden = !on;
      if (!on) close();
    },
    unmuteAll() {
      muted.clear();
      saveMuted();
    },
  };
}
