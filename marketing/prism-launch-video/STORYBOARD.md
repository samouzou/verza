# Meet Prism: launch video

**Length:** about 55 seconds. **Format:** 16:9, 1080p master (a 9:16 cut can come from the same shots).
**Tone:** warm, confident, human. Real people with real businesses, not a tech demo.
**Look:** natural light, shallow depth of field, documentary-commercial. Evergreen (#0E7C5A) accents in sets and
wardrobe tie the scenes to Prism's color. Product shots are crisp, on-brand interface cards, never AI-drawn screens.

## Structure

Two kinds of shots alternate:

- **Life shots** (Gemini Omni): the people Prism is for, at work, with their social running in the background.
- **Product inserts** (rendered from `cards/`): what Prism actually does, legible and accurate.

## Script

| Time | Picture | Voiceover |
|---|---|---|
| 0–8s | **Hook.** Three quick moments: a founder at 11pm staring at a blank LinkedIn post; a café owner wiping the counter while her phone buzzes; an agency lead with too many tabs open. | You started a business. Somehow you also became its content team. |
| 8–12s | **Meet Prism.** Light passes through a glass prism on a desk and fans into color. Title: *Meet Prism.* | Meet Prism. |
| 12–19s | **Founder (B2B SaaS).** She pastes her website into Prism, then leans back as the month fills in. Insert: brand setup, then the calendar filling across LinkedIn, X, Instagram and TikTok. | Prism learns your brand and your voice, then plans your month across LinkedIn, X, Instagram and TikTok. |
| 19–26s | **Local business (café).** Between customers, the owner glances at her phone and smiles. Insert: one idea becomes a LinkedIn post, an X post and an Instagram caption. | Every post is written for its channel, not copied everywhere. |
| 26–33s | **DTC brand (skincare).** The founder holds up her product; on her phone, a finished Reel plays. Insert: a branded carousel and a Reel. | It designs on-brand carousels and turns ideas into Reels and TikToks. |
| 33–40s | **Agency / marketing team.** Two teammates at a big monitor; one taps approve. Insert: the approval queue. | Your team reviews and approves in one place. |
| 40–46s | **Coach / creator.** Walking out of a gym into the sun, his phone buzzes: published. Insert: "Published to LinkedIn, X, Instagram, TikTok." | Then Prism publishes on schedule, so you can get back to the work only you can do. |
| 46–50s | **Montage.** Phones light up with likes and comments in each of their hands. | Founders, shop owners, brands and agencies, all humming. |
| 50–55s | **End card.** Prism by Verza logo. | Prism. Keep your social humming. Start free for seven days. |

**End card text:** *Prism by Verza* / *Keep your social humming.* / *Start your 7-day free trial* / *app.tryverza.com/prism*

## Cast (the people Prism is for)

| Role | Who | Setting |
|---|---|---|
| Founder | Woman, early 30s, Black, natural curls, cream knit sweater | Small loft office, late evening, then morning light |
| Café owner | Woman, 40s, Latina, evergreen apron, hair tied back | Neighborhood café, morning rush |
| DTC founder | Woman, late 20s, South Asian, linen shirt | Bright product studio with skincare bottles |
| Agency lead + teammate | Man, 30s, East Asian, glasses; woman, 20s, red hair | Open-plan agency studio, big monitor |
| Coach / creator | Man, 30s, white, athletic, evergreen hoodie | Boutique gym doorway, golden hour |

## Product inserts (cards)

| Card | Shows | Feature it proves |
|---|---|---|
| `01-setup` | Website URL pasted, brand brief and pillars drafted | Brand setup from your website |
| `02-calendar` | Month calendar filled with posts per channel | Month plans across four channels |
| `03-adapt` | One idea, three channel-native versions | Per-channel writing |
| `04-carousel` | A branded 3-slide carousel | Carousels and feed graphics |
| `05-reel` | A vertical Reel in a phone frame | Reels and TikToks |
| `06-approve` | Approval queue with an approve action | Team approvals |
| `07-published` | Published to four channels, with links | Auto-publishing |
| `title`, `end` | Title and end cards | |

## Audio

- **Voiceover:** Gemini TTS, one warm, conversational voice.
- **Music:** Lyria, an uplifting, light electronic/acoustic bed that builds into the montage and resolves on the end card.
- Life shots are generated without music or dialogue so one soundtrack runs under the whole film.

## Rebuilding

Run from this folder, with `GEMINI_API_KEY` set and a `.venv` that has `google-genai` installed:

1. `./render-cards.sh` renders every card and stage in `cards/cards.html` to `media/cards/` at 3840×2160.
2. `generate_video.py --batch shots/jobs.json` (from the Gemini Omni skill) generates the life shots into `media/shots/`. The founder and agency shots use the calendar and approval cards as screen references.
3. `python audio.py` generates the voiceover lines and music into `media/audio/`. Pass line ids (e.g. `v3 music`) to regenerate only those.
4. `python edit.py` trims the shots, animates the inserts, mixes the voiceover over ducked music and writes `out/meet-prism-16x9.mp4`.
