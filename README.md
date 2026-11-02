# Greed & Spite

A multiplayer party game for 3–6 players. One player is the dungeon master and hides gold behind trapped doors. Everyone else is a greedy adventurer out for themselves. Everyone plays DM once per match, and the highest total score wins.

## Run it on your computer

You need Node.js 18 or newer.

```
npm install
npm start
```

Open http://localhost:3000 in a few browser windows (use private windows so each one is a separate player).

## Put it online with Render

1. Push this folder to a GitHub repository.
2. On render.com, choose **New → Web Service** and connect that repository.
3. Settings:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free** is fine for a playtest
4. Deploy. Render gives you a link like `https://greed-and-spite.onrender.com`. Send it to your friends.

Things to know about the free tier:

- After 15 minutes with no visitors, the service goes to sleep. The next visitor waits up to a minute while it wakes. Open the link yourself a couple of minutes before everyone joins.
- The game lives in the server's memory. If Render restarts the service, games in progress are lost. Fine for a playtest; a paid instance or a database fixes this later.

## How to play a session

1. One person opens the site, enters a name and clicks **Create a game**.
2. Everyone else enters the 4-letter code and joins.
3. The host picks the number of rounds and starts.
4. Play over voice chat (Discord works well). Talking, bluffing and lying are part of the game.

If someone's browser closes, they can rejoin with the same code and the same name.

In the lobby the host picks rounds per dungeon and a pace (relaxed, normal or fast), and the lobby estimates how long the match will take. For a first session, 3 rounds is a good start.

Sound is on by default and every player can turn it off with the Sound button. Players hear a chime when it's their turn and a tick in the last five seconds if they haven't chosen yet.

## Teaching new players

The first time someone reaches a lobby, a short visual guide opens: 12 slides, each with a picture and two or three sentences (the gold and scoring, doors and scanning, speed, elements, the shop and Shortages, Shoves and Locks, following, ghosts, and the DM's purse and bribes). The lobby shows the host who has read it. During the game, the Help button opens the slide for whatever the player is doing right now.

Inside the game, doors show a red Weak or green Resist badge based on your element, the DM's trap buttons say which players each element hurts, and step guides on the adventurer and DM panels show what to do next.

## The screen

Everything fits in one window, with no scrolling:

- **Left:** the party (portraits, HP, gold, element) with match scores at the bottom.
- **Middle:** the top-down room, with the action bar under it. The side-view door hall appears here only for the reveal and the scores.
- **Right:** the selected screen.
- **Far right:** a sidebar of icons that switch the screen: Gear up, Journal, Shop, Talk, History and Menu for adventurers (plus Offers when the DM bribes you); Traps, Bribe, Talk, History and Menu for the DM; Haunt for ghosts. A red dot means something needs you.

**Phones** must be held sideways in a match; held upright, the game shows a "Turn your phone sideways" screen with a full-screen button (or, on iPhone, the Add to Home Screen tip). The home screen, lobby and How to play work either way.

## The room

Adventurers spend each round in a top-down stone room: the doors along the top wall, a campfire in the middle, and the shopkeeper behind a counter in the corner. Everyone sees everyone else walk around in real time.

- **Walking:** arrow keys or WASD, or click or tap where to go (tap-to-walk routes around the fire, counter and barrels).
- **The action button** (or E) does whatever you're next to: Shop, Scan Door II or Choose Door II, Rest by the fire, or Whisper to someone beside you.
- **Your plan** stays secret; where you stand means nothing, so standing at a door is a free bluff. If time runs out, the plan you've filled in counts even if you didn't lock it in. Instead of a door, your plan can be to follow someone (see below).

## The DM's trap workshop

The DM builds in the same room. Tap a door to select it, then use the **Traps** screen:

- **Purse** shows your trap purse, which only you see. It pays for traps, fake clues, a Shortage and bribes. Unspent purse carries over to the next round, but it isn't score.
- **The gold bar** splits the round's bait gold between the doors: drag the lines between sections (or use the arrow keys on a focused line). It always adds up and every door keeps at least 10. **Even** and **Bait** (most gold on the selected door) are one tap.
- **Your hand:** pick an element, then tap a trap card to place it on the selected door. Cards you can't afford are greyed out.
- **Fake clue:** make the selected door show any clue.
- **Shortage:** double one shop item's price for the coming round. The shopkeeper announces it when the doors open.

What you build on a door is gold hidden behind it: the cost of its trap and fake clue goes into that door's loot, for whoever survives it. The reveal shows each door's hidden gold.

The **Bribe** screen (while setting traps and while adventurers choose) sends secret offers: pick an adventurer, a door and an amount, and optionally "only if someone goes in with them". See Bribes below.

Only the DM sees placed traps drawn on the floor in front of their doors, and a weakness tag over each adventurer showing the element that hurts them most. While adventurers choose, the DM watches the room and sees whose lantern is lit on which door.

## Following

Instead of picking a door, an adventurer can follow another living adventurer from the Plan page. When the doors open, the follower copies the leader's final door and speed (not their items) and arrives with them, so they share the leader's fate. If the leader rests, the follower rests. Chains work (follow Ann, Ann follows Ben, you end up wherever Ben goes); a loop, or a leader who left, means resting.

- The leader sees "Someone is following you" by the action bar and on their plan page, and "They stopped following you" if the follower changes their mind. It never says who or how many, and nobody else is told anything until the reveal.
- In the last 10 seconds of choosing, nobody can start or stop following, so it can't be used as a last-second trap.
- Nobody can shove along a following link, up or down a chain: the Shove fizzles and is kept. A follower can still shove a third player, and a leader's Lock still locks followers out.

## Bribes

The DM can secretly offer a living adventurer gold to go through a door, from the trap purse: up to 2 offers a round, from 3 gold, until 10 seconds before choosing ends, optionally "only if at least one other adventurer goes in with you".

- The gold is set aside when the offer is made, so a bribe can never bounce. Offers made while setting traps arrive when the doors open; later ones arrive at once.
- The adventurer gets an **Offers** icon (with a red dot) and can accept or decline. Only the DM sees the answer, and accepting doesn't bind them.
- The bribe is paid as the adventurer goes through the door, before any trap damage (so it counts in what a dying adventurer drops). It returns to the purse if they decline, don't go, are locked out, or the condition isn't met. Followers count as company, and a bribed follower is paid only if their leader picks that door.
- The reveal and the story show bribes that were paid; everything else (offers, answers, returns) is only in the match log.

## Between rounds

The doors open one at a time. When the reveal ends, a 10-second reading pause starts with a **Ready** button; the next round begins as soon as everyone is ready or the pause runs out. The dungeon scores work the same way with a longer pause. There's no host button to press. **History** keeps every round's story for the current dungeon.

## Scanning doors with the lantern

Every door shows its gold, but its clue stays hidden until you scan it. The server never sends an unscanned clue to anyone's browser.

- **Scanning:** walk up to a door and use **Scan** (E on a computer). It takes 3 seconds and one oil flask. A close-up opens over part of the room: the door turns see-through, and the clue's atmosphere and rune appear. Only you see the result; everyone else sees a plain white lantern beam on that door.
- **Oil:** each round you get one fewer flask than there are doors, and you can carry as many flasks as there are doors. The shopkeeper sells extra flasks.
- **Illusions fool scans.** A **Lens** fixes that: turn it on in the action bar before scanning, and the scan shows the real trap and its strength. If the clue was fake, you see it shatter.
- **Rules that keep it fair:** you can't start a scan with less than 3 seconds left. Walking away, pressing Stop, or running out of time cancels the scan and gives the oil back. The result only arrives once the server's own 3 seconds have passed.

## The journal

The journal is a book. A strip at the top shows every door at a glance (gold, your scan result, your mark, and a star on your choice). Ribbon tabs jump to a door's page or the Plan page, and the book turns to the page of whichever door you walk up to. A door's page has its gold, your scan and Lens results, whether you're weak to or resist that element, any whispered rumours about it, and your own Safe?/Trap?/Liar? stamps (also drawn on the door in the room, for you only). The Plan page has speed, items, Follow someone, and Lock in.

## Menu, full screen and leaving

The Menu icon has sound, animations (on by default unless the device asks for reduced motion), full screen, the guide, the full rules, and Leave match.

- **Full screen** works on computers, Android and iPad. iPhones don't allow it for web pages, so the menu tells iPhone players to use Share → Add to Home Screen; the game then opens without Safari's bars.
- **Leaving:** a player who leaves can't rejoin that match. An adventurer who leaves keeps their gold for scoring but can't win. If the DM leaves, that dungeon ends early: adventurers are scored against only the bait that was placed so far, and the DM scores 0. Anyone who left is skipped when their DM turn comes. If fewer than 3 players remain, the match ends. Losing connection is different: you keep your place and can rejoin.

## Editing what people can say

Everything players can say lives in `messages.txt`: quick lines for adventurers, the DM and ghosts, what the merchant mutters, and the private huddle whispers. Edit it, push to GitHub, and Render redeploys with the new lines. One message per line, up to 24 per section and 60 characters each. In huddle lines, `{door}` becomes a door number the speaker picks. Lines starting with `#` are comments.

## Awards and the match log

After each dungeon, players get awards based on what happened: Greediest, The Canary, Most Spiteful, Grave Robber, Daredevil, Campfire Coward, Untouchable, and Trapmaster for the DM.

Between dungeons, at the end of the match, and back in the lobby afterwards, anyone can download the match log as text (easy to read) or JSON (for spreadsheets or scripts). It records every round: the DM's bait, purse spending, traps, hidden gold and Shortage, every bribe offer with its answer and outcome, everyone's choices, items and who they followed, what happened at each door, pickpockets, purchases, gains, scores and awards, with a summary per dungeon. Use it to tune the numbers after a playtest. It can't be downloaded mid-dungeon, because it contains traps and purchases that are still secret.

## What's in the folder

- `server.js`: the game rules, timers and hidden information. Every player gets only what they're allowed to see.
- `public/index.html`: the page shell.
- `public/style.css`: the dungeon look (stone, doors, torches, windows, buttons).
- `public/sprites.js`: original pixel-art adventurers, ghosts, the DM, and icons, drawn from small pixel maps. Edit a map to change a sprite.
- `public/room.js`: the top-down room: walking (tap-to-walk routes around the fire, counter and barrels), collision, the shopkeeper, the campfire, lantern beams, and what you're standing next to.
- `public/scanview.js`: the lantern close-up shown while scanning a door.
- `public/manifest.webmanifest` and `public/icons/`: lets the game be added to a phone's home screen.
- `public/scene.js`: the side-view door hall: the DM's builder and the animated reveal each round (movement by speed, doors opening, element trap effects, coins, haunts, deaths). Has Skip and Replay, and players with "reduce motion" turned on go straight to the result.
- `public/sound.js`: every sound effect, synthesized in the browser (no audio files).
- `messages.txt`: everything players can say. Edit freely.
- `public/tutorial.js`: the slide-by-slide guide. Each slide is a title, a short text, and a picture built from the game's sprites.
- `public/app.js`: screens, controls, the match log download, and the connection to the server.

## Tuning the numbers

Every number in the game is in the `C` block at the top of `server.js`: HP, starting gold, trap damage and cost, bait and purse per round, Shortage cost, pickpocket share, the following freeze, bribe limits, item prices, approach multipliers, timers. Change them, restart, play again.

For quick solo testing, `TIME_SCALE=0.2 npm start` makes every timer five times shorter.

## Rules summary

- Each round the DM places bait gold on the doors (at least 10 each, in steps of 5). Bait per door ramps from 20 in round 1 to 60 in the last round. The dungeon's **treasury** is all its bait.
- The DM also gets a secret **trap purse** each round. It buys traps (Minor 20 dmg for 8 gold, Major 35 for 14, Deadly 50 for 20; every trap has an element), fake clues (5) and one Shortage (6: an item costs double this round). Unspent purse carries over but isn't score.
- What the DM builds on a door is hidden gold behind it, looted along with the bait by whoever survives.
- A trapped door's clue shows its real element. An empty door shows nothing. An illusion fakes either.
- Adventurers secretly pick a door and Sprint (3 bags, ×1.5), Walk (2 bags, ×1) or Sneak (1 bag, ×0.5), or Rest (+10 HP).
- Only the fastest group into a room springs the trap. A room needs 3 bags to empty; with more, gold splits by bags.
- Elements: your element resists itself (×0.5) and is weak to the one that beats it (×1.5). Water > Fire > Air > Earth > Water.
- Items are single use: Shove 5, Oil flask 7, Charm 8, Potion 12, Lens 12, Armour 14, Lock 15.
- A Shove that lands also pickpockets 10% of the target's gold after the loot. A Lock on that door stops it.
- Instead of a door, you can secretly follow another adventurer: you copy their final door and speed, not their items. The leader only learns that someone follows them. No starting or stopping in the last 10 seconds, and no shoving along a following link.
- The DM can secretly bribe up to 2 adventurers a round to pick a door (from 3 gold, out of the purse). It's paid on entry, before any trap, and returns to the purse otherwise.
- At each door, in order: bribes paid, trap damage, loot (the dead get none), pickpocketing, haunts, then deaths drop half their gold.
- While the shop is open, you see other players' gold and HP as they were when trap-setting began. Real values show at the reveal.
- At 0 HP you drop half your gold and become a ghost. Ghosts see every trap and haunt one adventurer per round, stealing 25% of their gold if a trap hurts them.
- Starting gold (40) is pocket money. Gain = gold held at the end − 40. Adventurer score = gain × adventurers ÷ treasury × 100. DM score = (treasury − all adventurers' gains) ÷ treasury × 100. Scores can be negative.
