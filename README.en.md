# 🎬 BB Visual Novel Engine — Extended

[Русский](README.md) · **English** · [Changelog](CHANGELOG.md) · [Portraits](docs/portraits.md#english)

Turn your roleplay chat into a visual novel: choose your actions, follow relationships and keep the moments that matter. The Extended build adds one-toolbar control over the extension, on-the-spot editing of any event, and reliable story transfer between chats.

<p align="center">
<a href="img/%D0%94%D0%B5%D0%B9%D1%81%D1%82%D0%B2%D0%B8%D1%8F%20VN.png"><img src="img/%D0%94%D0%B5%D0%B9%D1%81%D1%82%D0%B2%D0%B8%D1%8F%20VN.png" alt="Three VNE action choices with distinct tones and generation controls" width="945" /></a>
</p>

**3.5.0 Extended** · built on [maxkara14/BB-Visual-Novel-Engine](https://github.com/maxkara14/BB-Visual-Novel-Engine): everything from the original plus the Extended toolset.

## ✨ Features

| Feature | What it offers |
| --- | --- |
| 🎬 **VN Actions** | Three ways to continue a scene, with different tones and short outcome hints |
| 💞 **Relationships** | Separate trust and romance scores, change history and score breakdowns |
| 📖 **Character memory** | Memories, lasting personality traits and an event diary |
| 👤 **Character cards** | Avatars, descriptions, search, sorting and compact view |
| 🖼️ **Portraits and gallery** | Generation with references, cropping, saved variations, downloads and copying |
| 💾 **Snapshots** | Export and import the active persona's relationships and memory; Extended snapshots also store raw per-message events |
| 🧰 **Extended toolbar** | Settings, developer console, hidden characters, export/import and tracker or generator toggles — all from the HUD header |
| ✏️ **Event editing** | Edit or disable any event in a card, journal entry or diary page, with undo; scores recalculate automatically |
| 🔄 **Swipe isolation** | Per-reply data is stored separately and never mixes when swipes change |
| 🌐 **Two languages** | Russian and English UI with a separate language choice for new replies |

## 🧰 What Extended adds

- **HUD toolbar** — six buttons in the panel header (⚙️ Settings, 🛠 Dev, 📤 Export, 📥 Import, 👁️‍🗨️ Hidden, 🎬 Generator). Popups float next to their button, stay on screen and never flicker while switching.
- **Tracker and generator toggles** — click the "active/disabled" indicator in the header to suspend the relationship tracker; disable options generation from the button near the input box, the toolbar icon or settings.
- **On-the-spot event editing** — journal entries, diary pages and memory traces in a character card are edited and disabled through inline forms. Edits can also be undone with the Undo button right in the list.
- **Prompt instructions editor** — a split view: editable instructions (with a "custom" badge) and automatically assembled character data (read-only).
- **v2 snapshots** — exports include the raw events of every message; on import the story is restored and recalculated in full. v1 snapshots from the original and versions 3.2–3.4 keep working.
- **Swipe isolation** — data is bound to the message and swipe; a pre-prompt recalculation and stale-data guards keep swipes from affecting newly generated replies.
- **Interface niceties** — memory pagination, delta badges (+N/−N) on entries, scrolling long names, smooth auto-scrolling to the revealed spot, diary anti-aliasing and optional GPU rendering.

## 📦 Installation

1. In SillyTavern, open **Extensions → Install extension**.
2. Paste: `https://github.com/Proquror/BB-Visual-Novel-Engine-Extended`.
3. Reload the page and open **BB Visual Novel Engine Extended** settings.
4. Choose a generation connection and open a chat.

After updates, use **Ctrl+F5** if needed.

**Upgrading from Extended 3.4:** remove the old extension and install it again from the link above — the two version histories are unrelated. Relationship data lives in your chats and settings live in Tavern's settings, so nothing is lost; you can still export a snapshot in the old version just in case.

## 🎮 How to play

After a character replies, click **VN Actions** and choose a continuation.

- **Auto-send off:** the reply appears in the input box. Read it, edit it and send it yourself.
- **Auto-send on:** the reply is sent immediately, without a preview. This is enabled by default.

Use the request button to guide the next generation. Persistent preferences and reply length are available in settings. Choose how much history options use, from 1 to 100 messages.

You can disable the action panel while keeping relationships and memory. The small **VN** button beside the input box brings it back. Scene Director context is included when used.

## 💞 Relationships and characters

<table>
<tr>
<td width="42%" align="center" valign="top">
<a href="img/VNE.png"><img src="img/VNE.png" alt="Tsunade character card: trust, relationship dynamics and memories" width="340" /></a>
</td>
<td valign="top">
<h3>Every character has a story</h3>
<p><b>Relationships.</b> Trust, romance and recent changes in one card.</p>
<p><b>Memory.</b> Soft traces and defining events you can revisit and edit.</p>
<p><b>Personality.</b> Descriptions, portraits and lasting traits help preserve character identity.</p>
<p><b>Navigation.</b> Search, compact view and a hidden-character list.</p>
</td>
</tr>
</table>

The side panel contains character cards, a log and a diary. Expand a card to see memories and how trust and romance scores are calculated.

The log (the "System") and the diary are different things. The journal collects events with non-zero trust or romance scores, plus system actions like a relationship reset. The diary gathers special moments: a character's first appearance in the tracker, a tone shift in the relationship, noticeable changes (±2 or more, when the model explains the reason) and unforgettable events (±15 or more). An event with zero scores enters neither of those nor memory — only the relationship status it set counts, if any.

Search, sorting and compact view help navigate a growing cast. **Hidden · N** opens a list with individual and bulk restore. Hiding does not erase events: restoring a character recalculates relationships from stored history.

Edit a character's name, avatar and description. **From template** builds a description from available sources; customize the shared instructions under **Language and replies → Character description prompt**.

The unified **relationship editor** is under **Data** in the settings. Search entries; edit chat relationship changes (reason, emotion, trust, and attraction); edit or hide memories and traits; and remove unwanted characters, journal entries, and moments from the imported baseline. Editing an event recalculates scores, memories, and the journal. Editing a memory or trait alone does not change scores or the source event.

Extended also edits events without leaving the panel: journal entries, diary pages and memory traces in a character card all carry edit buttons. Editing a trace in any of the three places — memory, journal or diary — updates the others. Memory traces show impact deltas (+N/−N), and long lists of more than four unforgettable events expand via a button.

## 🖼️ Portraits and gallery

<table>
<tr>
<th width="50%">Create a portrait</th>
<th width="50%">Keep your favourites</th>
</tr>
<tr>
<td valign="top"><a href="img/%D0%90%D0%B2%D0%B0%D1%82%D0%B0%D1%80.png"><img src="img/%D0%90%D0%B2%D0%B0%D1%82%D0%B0%D1%80.png" alt="Portrait workshop: prompt, style, references and preview" width="440" /></a></td>
<td valign="top"><a href="img/%D0%93%D0%B0%D0%BB%D0%B5%D1%80%D0%B5%D1%8F.png"><img src="img/%D0%93%D0%B0%D0%BB%D0%B5%D1%80%D0%B5%D1%8F.png" alt="Portrait gallery: selection, downloading and copying" width="440" /></a></td>
</tr>
</table>

*Click any screenshot to view it at full size.*

Click **Portraits** beside the avatar in the character editor.

**Create:** write a prompt or build one from the description and scene. Add a shared art style and up to four appearance or style references. Preview the result, adjust the crop and save the card.

If appearance details are missing when building a prompt, complete them with AI using the world context or edit the prompt yourself. The builder also uses persona and setting information.

**Gallery:** new generations are saved per chat, persona and character, even if you do not apply them. Choose another portrait, download its original or copy the image.

Images use a separate connection: **OpenAI Images, OpenAI Chat, Gemini or Naistera**, with model selection and saved profiles. Image generation and reference support depend on the service and model.

Under **Images → Image parameters**, OpenAI Images offers explicit GPT Image or Grok modes, resolution, aspect ratio and quality; GPT supports optional exact dimensions, and the GPT Image 2.5 mode offers `xhigh` / `max`. Portraits default to square, and existing profiles retain compatible behavior. Automatic GPT dimensions respect the pixel cap: square 4K is 2880×2880, 3:4 is 2480×3312. Profiles store these parameters; GPT sends reference files and Grok sends JSON. See the [portrait guide](docs/portraits.md) for details and size limits.

[Read the portrait guide →](docs/portraits.md#english)

## ⚙️ Connections and languages

Choose one source for options, character descriptions and traits:

| Source | How it works |
| --- | --- |
| **Current SillyTavern connection** | Uses the main model |
| **Connection Manager profile** | Uses a saved profile without switching the chat connection |
| **Custom API** | Connects using a URL, key and model |

Usually, leave the response format on **Auto**. If the model does not support Schema, choose **Prompt instructions only**. For truncated replies, check the token limit; Custom API exposes it in advanced settings.

Interface language and the language of new replies are independent. Existing descriptions and memories are not translated automatically. Reload after changing the interface language.

## 💾 Moving your story

Export saves the active persona's relationships, memories, traits, descriptions and avatars. Import **replaces the relationship baseline** instead of adding two sets together. Chat messages remain intact.

Extended snapshots (v2 format) additionally store the raw events of every message. Importing into a long-enough chat restores them with a full recalculation from the start of the story; importing into an empty or short chat applies the snapshot as a baseline — no events are lost. v1 snapshots from the original and versions 3.2–3.4 keep working.

New avatars and their sources are saved as separate files in `user/images/bb_vne_assets` on the Tavern server. Chat metadata holds short paths instead of embedded images. **Data → Move chat images to files** converts existing images across all personas and saved branch states in the current chat. Previously created separate chats are not rewritten. A full JSONL backup is downloaded first; import it as a separate chat to roll back. Every file is verified byte for byte before references change. Errors or context changes cancel the transfer; files already uploaded may remain on disk. PNG, JPEG, WebP, GIF and BMP up to 10 MiB per image are supported; an unsupported source cancels the entire transfer without changing embedded images.

Snapshot export through settings includes avatars and sources, keeping JSON portable between servers (v2 format, up to 100 MiB). Import saves those images as files first. The exported JSON can still be large; it is not stored in the chat. When moving the entire Tavern installation or a regular JSONL chat, keep the `images` folder too. Image files are not automatically deleted.

**Remove imported baseline** restores the baseline from before the first import and recalculates the current chat history. It does not roll back messages.

A new branch receives relationship state at the selected message. Later imports and edits in the parent chat do not carry into an earlier branch. VNE warns when an older chat lacks the revision history needed to verify the exact state.

**Data → Relationship editor** labels each entry as chat or import. Disabling a chat change removes its contribution to scores, memories and the journal; the event belongs to its own swipe, so other variants of that message are not affected. The flag lives as long as the chat does; disabled events can be restored with the Undo edit button in the relationship editor (developer console). Removing a character from the imported baseline can change base scores, while removing a journal entry or moment does not change scores. Event edits follow chat branches at the selected message.

The portrait gallery is stored separately: moving it requires chat metadata and SillyTavern image files. Removing a gallery entry does not delete its disk file.

## 🗺️ Map context

Enable **Use map context** in settings to include the current chat’s saved map when generating VN response options. It is off by default; without a map, generation works normally. Requires [BB Interactive Map 2.0](https://github.com/maxkara14/BB-Interactive-Map).

## 📸 Screenshots

<img width="942" height="236" alt="BB VNE options" src="https://github.com/user-attachments/assets/90d3f105-93a5-4a94-8e5b-c1a4e1bd0c93" />

<img width="1918" height="1126" alt="Social Link HUD" src="https://github.com/user-attachments/assets/b73f8fb3-b1dd-455b-a52b-2fc7615aeb1c" />

## 🔗 Authors

- [BruniikBron: Lo-Fi & Mods](https://bblofi.online/) · [Telegram](https://t.me/Brun11kBr0n) — the original BB Visual Novel Engine
- [maxkara14](https://github.com/maxkara14) — the [BB Visual Novel Engine](https://github.com/maxkara14/BB-Visual-Novel-Engine) mod this build is based on

### Author of this version

- Me. What about it?
