# Raycast AI keybindings — reference for LUUNA-AI

Fact-checked against Raycast's own manual (`manual.raycast.com`, v2). The AI pages live
at `/ai/ai-chat` and `/ai/quick-ai`; `/ai-chat` and `/quick-ai` 404. `docs.raycast.com`
does not resolve (DNS ENOTFOUND) and was never used.

`Mod` below means **Cmd on macOS, Ctrl on Windows/Linux** — how Raycast documents the
same gesture on both platforms.

## AI-specific shortcut table

Source: `/keyboard-shortcuts.md`, `/ai/ai-chat.md`, `/ai/quick-ai.md`,
`/ai/ai-commands.md`, `/ai/screen-awareness.md`.

| Chord (macOS) | Windows | Action | Source |
|---|---|---|---|
| `⌘ Space` / `Alt Space` | `win` | Open or close Raycast | KS, Settings |
| `Tab` | `Tab` | From Root Search: open Quick AI | QAI |
| `⌘ J` | `Ctrl J` | Send selected item to AI Chat; continue a Quick AI thread in AI Chat | KS, AICHAT |
| `⌘ K` | `Ctrl K` | Open / close the Action Panel | KS, Action Panel |
| `↵` | `Enter` | Send message / submit prompt | AICHAT, QAI |
| `⇧ ↵` | `Shift Enter` | New line in the composer | AICHAT, KS |
| `⌘ ↵` | `Ctrl ↵` | "Do the opposite once" of the follow-up behaviour (Queue vs Steer) | AICHAT |
| `⌥ ↵` | — | The "opposite once" key when `⌘ ↵` is your primary Send Message shortcut | AICHAT |
| `↑` / `↓` | `↑` / `↓` | Empty composer: edit the last message, step through earlier/later messages | AICHAT, KS |
| `⌘ R` | `Ctrl R` | Regenerate the last response (same model) | AICHAT, QAI |
| `⇧ ⌘ R` | `Ctrl Shift R` | Regenerate with a **different** model — *Quick AI page only* | QAI |
| `⌘ N` | `Ctrl N` | New chat / fresh conversation | AICHAT, QAI |
| `⇧ ⌘ S` **or** `⌘ B` | `Ctrl Shift S` / `Ctrl B` | Toggle the chat history sidebar | KS |
| `⇧ ⌘ F` | `Ctrl Shift F` | Search chats | KS |
| `⌘ F` | `Ctrl F` | Open Find in Chat | KS, AICHAT |
| `⌘ G` / `⇧ ⌘ G` (also `↵` / `⇧ ↵`) | `Ctrl G` / `Ctrl Shift G` | Next / previous match | KS, AICHAT |
| `⌘ 1`…`⌘ 9`, `⌘ 0` | `Ctrl 1`…`Ctrl 0` | Jump to the first ten chats in the sidebar | KS |
| `⇧ ⌘ A` | `Ctrl Shift A` | Add attachment to the composer | KS |
| `⇧ ⌘ B` | `Ctrl Shift B` | Branch the chat from a message | KS |
| `⇧ ⌘ M` | `Ctrl Shift M` | Change the AI model | KS |
| `⇧ ⌘ Y` | `Ctrl Shift Y` | Change the creativity level | KS |
| `⇧ ⌘ U` | `Ctrl Shift U` | Change the reasoning effort | KS |
| `⌥ ⌘ A` | `Ctrl Alt A` | Archive the chat | KS |
| `⌃ ⇧ X` | `Ctrl Alt D` | Delete all unpinned chats | KS, AICHAT |
| `⌃ ⌘ N` | `Alt Shift N` | Create a project | KS, Projects |
| `⌃ ⌘ M` | `Alt Shift M` | Move the chat to a project | KS, AICHAT |
| `⇧ ⌘ =` | `Ctrl Shift =` | Upvote / good response | KS, QAI |
| `⇧ ⌘ -` | `Ctrl Shift -` | Downvote / bad response | KS, QAI |
| `⌃ M` | `Ctrl M` | Start dictating / accept the dictation in progress | KS, AICHAT |
| `⌘ -` / `⌘ +` / `⌘ 0` | `Ctrl -` / `Ctrl +` / `Ctrl 0` | Zoom the AI Chat window out / in / actual size | AICHAT |
| `⌘ [` / `⌘ ]` | `Ctrl [` / `Ctrl ]` | Previous / next **Quick AI** chat — *Quick AI only* | QAI |
| `/` | `/` | Composer's slash menu — agent + model-preference switcher | AICHAT, Agents |
| `@` | `@` | Attach context | AICHAT, QAI |
| double-tap right `⇧` | — | Quick Fix (the default) | AICOM |
| double-tap right `⌘` | — | Send Focused Window to AI (suggested default at setup) | SA |

## The Action Panel model (the closest analogue to a command palette)

From `/action-panel.md`:

- `⌘ K` / `Ctrl K` "Opens the full Action Panel, showing all available actions for the
  selected item."
- Actions are grouped into **sections** (Primary Action, then Favorites / Configure /
  Deeplink / Manage); sub-menus and custom views are supported; `Esc` walks back.
- "Each action shows its keyboard shortcut on the right, so you can learn to trigger them
  directly over time."
- `↵` primary action, `⌘ ↵` secondary, `⌥ ↵` tertiary; typing filters.
- "Search for actions…" field with fuzzy matching; when searching, matches collapse into
  a single flat list.
- Users can define custom actions with icons, titles, shortcuts and named sections;
  actions can be marked destructive.
- AI Chat reuses the shared Action Panel for its own verbs (Change Agent, Change Model,
  Branch Chat, Move to Project, Copy Chat, …) — it has no bespoke palette.

## How Raycast lets users rebind (the model to copy)

**Settings → Shortcuts** is the central place:

- "A complete list of all commands with their aliases and hotkeys visible inline."
- Search, plus filters by category and by status (Hotkey Set / Alias Set / Enabled /
  Disabled).
- Inline editing: click any alias or hotkey field to edit it directly.
- Alternatively: select a command in Root Search → `⌘ K` → **Configure Command** → **Set
  Hotkey**.

**The recorder**: real-time key display as styled key buttons; auto-save with a ~1.5
second countdown (or `↵` to save immediately); conflict warnings *naming the conflicting
command*; `✕` to remove the hotkey, or `Backspace` while recording to clear it.

**Conflicts**: a clash with Raycast's own launcher hotkey is rejected outright; a clash
with another command shows the owner and offers **Overwrite** (the loser loses its
hotkey).

**Caveat — the important one**: Raycast's *built-in navigational chords* (`⌘K`, `⌘F`,
`⌘W`, `⇧⌘/`, …) are **not** rebindable. Only command hotkeys and aliases are. Settings
that genuinely change a key: the launcher hotkey, the AI send key, the AI follow-up
behaviour, pagination keys, navigation bindings, escape behaviour, and per-command
hotkeys. LUUNA deliberately diverges here — it makes every binding rebindable.

## Documented conflicts and traps

1. **`Alt+Space` is the macOS default only.** Windows defaults to the `Win` key. The
   Keyboard Shortcuts page's "`⌘ Space`/`Alt Space`" pairing misleads; Settings → General
   is explicit that Windows uses the Windows key.
2. **`Esc` cancelling a generation run is NOT documented.** Documented `Esc` behaviours:
   cancel a message edit, cancel dictation, close the Find-in-Chat bar, close the Action
   Panel, go back, close the window (Settings → Keyboard → Escape Key Behavior). Run
   cancellation is described with no chord ("empty input still cancels a run").
3. **`⇧⌘R` is Quick-AI-only.** The AI Chat page never lists it; AI Chat's equivalent is
   the Action Panel action "Regenerate with Model…".
4. **Windows "delete unpinned chats" is `Ctrl Alt D`**, not `Ctrl Shift X` — Raycast
   deliberately remaps it.
5. **The send key is genuinely contradictory in the manual.** The AI Chat page says `↵`
   sends and `⇧↵` newlines; Settings → AI → Chat → Send Message says the default is
   `⌘ Return`. The manual never reconciles them, and the "opposite once" key flips
   between `⌘↵` and `⌥↵` depending on which one is primary.
6. **`⇧⌘F` is double-documented** (AI Chat "Search chats" vs Root Search / Action Panel
   "Add to Favorites") and **`⇧⌘B` is double-documented** ("Branch chat from a message"
   vs "Report a bug"). Context-scoped in Raycast.
7. **`⌘[` / `⌘]` are Quick AI only**; AI Chat has no documented equivalent.
8. **Model switching has no dedicated toggle chord** — it is `/` in the composer or the
   title bar; `⇧⌘M` is the Action Panel shortcut.
9. **Double-tap gestures and commands are not chords.** `Tab` (Quick AI) and the
   `Send … to AI` commands are entry points; Quick Fix and Send Focused Window to AI are
   double-tap gestures.
10. **Not documented anywhere** — do not invent these: `⌘⇧Space`; a dedicated "Ask AI"
    desktop hotkey; a "copy answer" chord inside AI Chat (there is a copy *button* and a
    "Copy Chat" action, but no chord); "open answer in editor"; a markdown/preview
    toggle; a keyboard-shortcuts help overlay; "select text and ask AI" as a chat-window
    chord; a "quick model" picker toggle. There is also **no documented default hotkey**
    for the AI Chat, Quick AI or AI Commands windows — the manual simply never states
    one, and never states that none exists.

## What this means for LUUNA-AI

Raycast's own shortcuts are user-assignable, and its defaults differ from several of the
values above depending on version and platform. The lesson to copy is the *shape*, not
the literal table:

1. Every action has a stable **action ID**, independent of its key.
2. Every action has a **default chord** and a **user override**.
3. The UI renders whatever chord is currently bound (menu hints, key bar, help screen,
   palette rows) — nothing is hardcoded in a help string.
4. `Cmd` and `Ctrl` are distinct modifiers on macOS, and the app is usable from either.
