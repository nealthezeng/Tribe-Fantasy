# Avatars

Status: awaiting the user's approval. Date: 2026-11-04. Ship by the end of Nov 5.

## Why

The league is a small group of friends, but every team is a line of text. The user wants people to have something of
their own to fiddle with on the Me page, and to see each other's little characters next to team names. It should be
fun and recognizable, not a profile-photo feature.

Today an "avatar" is only the gold circle with your initial in the top bar (`Layout.tsx`, `.avatar` in `styles.css`).

## Goals

- Anyone signed in can build a character on the Me page from combos of pose, clothing, accessories and colors.
- It appears next to their team wherever a team is ranked or headlined.
- It reads on a phone at the size it is actually shown.

## Non-goals

- Photo or image uploads. Everything is drawn in code from a fixed set of parts.
- A different avatar per team or per league.
- Unlockable or earned parts. Anyone can wear anything, including the crown.
- Animation.

## Anti-goals (failure even if it works)

- Normal standings rows get taller than they are today, or the League tab feels cluttered or slower.
- Anything appears on the tally board, which stays plain and never animates. The top bar above the board is not part of
  it, and the figure there is static.
- A blank or broken figure ever shows, including for accounts that never opened the picker or hold a stale part name.
- The figures read as portraits of real people. That is why there are no skin tones.

## The look (user's decisions)

From the mockups in `docs/superpowers/specs/assets/2026-11-04-avatar-catalog.html`, which is the working reference
for every shape and color below. It is a throwaway page, so port the drawing ideas and not its code structure. Bottom
colors and the "Background" name below supersede what that page shows.

- 2D, Smiski-inspired: a big round head on a small body, with thick round limbs.
- Sticker style: flat color, a white die-cut edge around the whole figure, two dot eyes, no glow.
- The figure **breaks out of a colored circle** behind it. The circle is slightly smaller than the avatar's box and the
  figure pokes past its edge.
- **48px in standings rows.** At that size the pose, hat and eyes all read. 56px is only the rows' minimum height: a
  normal two-line row is about 62px today, and a 48px avatar with today's padding would make it about 65px. Trim the row
  padding so a normal row stays no taller than today.

## The parts (user's decisions)

| Part | Options |
|---|---|
| Pose (10) | Forehand, Layout, Skying it, Finger spin, Trophy, Cheering, Shrug, Water break, Winded, Peeking |
| Frisbee color (7) | Red, Tangerine, Gold, Deep blue, Green, Purple, Charcoal |
| Hat (10) | None, Headband, Cap, Backward cap, Bucket hat, Beanie, Visor, Crown, Traffic cone, Propeller |
| Face (6) | Just eyes, Shades, Glasses, Eye black, Blush, Mustache |
| Extra (4) | None, Medal, Scarf, Cape |
| Top (4) | Tee, Tank, Long sleeve, Hoodie |
| Top color (8) | Deep blue, Gold, White, Charcoal, Baby blue, Red, Green, Purple |
| Bottom (3) | Shorts, Long pants, Tutu |
| Bottom color (8) | The same eight as Top color |
| Body color (8) | Gold, Baby blue, Chalk, Mint, Coral, Lilac, Butter, Tangerine |
| Background color (8) | Deep blue, Baby blue, Gold, Lilac, Coral, Mint, Navy, Charcoal |

- "Background color" is the colored circle behind the figure. The user chose that name so it is not confused with the
  frisbee, so never call it "disc" in the interface. Avoid "disc" for it in code too.
- The frisbee is solid with a darker rim, never white with a thin edge: that read as a halo. In Skying it the frisbee
  sits off-center and tilted for the same reason.
- Cut by the user, do not bring back: Hiding, Flopped, Knee hug, Cross-legged, Stretching, Hammer, Bid paddle, Kilt,
  Stripes.

## Behavior

### One avatar per person

The avatar belongs to the account and shows on all of that person's teams, in every league. This matches where the name
lives (`profiles`).

### Nobody starts blank

An account with no saved avatar gets a random figure picked from its user id, so it stays the same on every device and
every visit. A membership whose user was removed (`user_id` null) picks from the membership id. Removed users have no
account to edit, so theirs stays generated.

Adding parts later can change generated figures. That is acceptable, because saved avatars never change: mark it with a
`ponytail:` comment.

### The picker on Me

A new card on the Me page, above Your name.

- A large live preview, with one row each for the parts above. Choosing an option changes the preview only.
- **Save** stores it. A **Shuffle** button fills every part at random, in the preview only. Nothing is stored until Save.
- If a part does nothing in the current pose, hide its row. Frisbee color shows only for the four poses holding one.
  Peeking hides the body, so it hides Top, Bottom, Bottom color and Extra, but keeps Top color because the ledge it
  peeks over takes that color.
- Hidden parts keep their value, so switching pose and back loses nothing.
- Options are real radio inputs in labeled groups, with visible focus and tap targets of at least `--tap`.
- Leaving without saving drops the preview. No warning, since nothing lost is hard to redo.

### Where it shows

| Place | Size |
|---|---|
| Standings rows (`RankList`: League tab, Leaderboards, past tournaments) | 48px |
| League matchup header (`HeadSide`, both teams) | 48px |
| Team page header | 96px |
| Picker preview on Me | 160px |
| Top bar account button, replacing the initial | fits the existing 34px circle's slot; the figure may be cropped to the circle |
| Admin People row (only where a reset is offered, so the admin sees what they are resetting) | 48px |

Not shown: the tally board, game lists, the buy list, Join a league, and admin tables other than the People row.

The avatar is decoration next to a name, so it is `aria-hidden`.

### Admin powers

Admins can reset anyone's avatar to their generated figure, from that person's row in Admin > People. This exists in
case a combo is used to bother someone. Nothing else needs overriding. The reset is audited with the old value.

### Destructive actions

- Saving your own avatar overwrites your previous one. Undo: none needed, you can re-pick it, and the preview shows the
  result before Save.
- Admin reset. Confirm: "Reset <name>'s avatar to a random one? They can pick a new one any time."

## Data and security

Migration `0031_avatars.sql`, additive:

- `profiles.avatar jsonb`, null meaning "use the generated figure".
- `set_avatar(p_avatar jsonb)`: any signed-in user with a profile, own row only. Accepts an object of at most 12 keys
  whose values are strings of at most 24 characters, otherwise `BAD_AVATAR`. `NO_PROFILE` as elsewhere.
- `admin_reset_avatar(p_user uuid)`: admin only, sets null, `NOT_FOUND` if there is no profile, audited like
  `admin_set_display_name`.
- `profiles_read` already lets league members read every profile, so no new read policy.

SQL deliberately does not know the part lists, so adding a hat never needs a migration. The browser is what guards the
drawing: **a stored value is only ever a lookup key into the part lists and is never written into the SVG.** Unknown or
missing keys fall back, part by part, to the generated value. A hand-crafted `set_avatar` call can therefore only ever
produce a valid figure.

Follow the existing conventions: `rpc.ts`, `errors.ts`, `rpc-gate` test lists, default-deny grants, and a rollback note
in `docs/setup-supabase.md`.

## Code shape

- `src/app/lib/avatar.ts`: the part lists and `resolveAvatar(stored, seed)`, pure, no React.
- `src/app/components/Avatar.tsx`: draws a resolved avatar at a given size.
- Part colors live with the parts as art data, not in `tokens.css`. Add that exception to the comment at the top of
  `tokens.css`. A theme change does not recolor avatars. Sizes are tokens.
- `loadLeagueTournament` adds `avatar` to its `profiles` select and exposes a membership-to-avatar map beside `team` and
  `owner`. `OverallStanding` gains the same field, so `RankList` needs no extra loading.
- `AuthProvider` loads the signed-in user's avatar for the top bar, and refreshes it after Save the way it does for the
  name.

## Constraints

- Mobile first, at 375px, dark and light themes. On light pages the white edge disappears against white panes, and the
  figure must still read.
- Team names lose space to the avatar column: about 195px down to about 145px at 375px, even after narrowing the rank
  column as far as "T12" still fits (the mockup used 32px, from 44px). Names can be 40 characters and the small line can
  be long in All leagues. Long text wraps and that row grows; never cut it off, because the name is how people find a
  team. Rows already vary this way today.
- No new dependencies.
- **Go-live order:** the user pastes `0031` before the push, because the new build selects `profiles.avatar`. The old
  site ignores the new column, so the paste is safe at any time.
- **Timing (user's decision): ship before the freeze.** CCCs are Nov 7-8 and the app is frozen Nov 6-8, so the push must
  land by the end of Nov 5. If it isn't solid by then, hold it on the branch and ship after Nov 8. A rushed ship must not
  put the tournament at risk.
- **If time runs short, cut in this order:** the team page avatar, then the matchup header, then the top bar. The picker,
  standings rows and admin reset ship together or not at all.
- **Rollback:** revert the push. The column stays in the database and the old site ignores it. Installed apps get a new
  build on their second return, so finish early enough for that before Nov 7.

## Testing

- Unit: `resolveAvatar` is stable for a seed, ignores unknown keys and junk input without throwing, and every part
  combination the lists allow draws without error.
- DB (PGlite): `set_avatar` own row only, size limits, anon refused; `admin_reset_avatar` admin only and audited;
  `rpc-gate` updated.
- UI: the picker's Save and Shuffle, hidden rows per pose, avatars present in `RankList` and absent from the tally board.
- Visual, in the sim at 375px, both themes: Me, League, Leaderboards, Team page, Admin People.
- The user checks it on a real phone after the push. A desktop screen cannot settle whether 48px feels right, and the
  check must leave time to roll back before the freeze.

## Left to the builder

- Redrawing the mockup's rough shapes. The figure must stay large at 48px, so tighten the widest poses (Layout and
  Forehand). Show the user a sheet of the final ten poses before shipping, since the drawings are what they care about.
- The picker's exact row layout (scrolling strip or wrapping grid), judged at 375px.
- Whether each option thumbnail shows the whole figure or a head crop.
- Which parts `set_avatar` audits, matching `set_display_name`.

## Calls Claude made (not the user's, open to change)

- One avatar per person, not per team. (Played back and not objected to.)
- A generated figure for anyone who has not customized, instead of a blank one.
- A hat takes the top color; a charcoal top gets a gold hat so the hat doesn't vanish on the dark page. Crown and
  Traffic cone keep their own colors, and the Propeller keeps its red blades. This keeps the picker one row shorter.
- Medal, Scarf and Cape have fixed colors.
- No skin tones.
- The sizes table above, including 96px on the team page and 160px in the picker.
- Showing the avatar on the Admin People row.
- Long names wrap and grow the row instead of being cut off.
- The cut order and the end-of-Nov-5 stop line.
- The avatar shows in the top bar on the tally page too, with no special case. Only the board is kept clear.

