# Nepali CardRoom — Vercel + Supabase

A private friends-only virtual-coin card room with Kitti, Teen Patti and Texas Hold'em, room codes, usernames, realtime table updates and an admin coin panel.

## 1. Supabase
1. Create a Supabase project.
2. Open SQL Editor and run `supabase.sql`.
3. In Database > Replication, enable Realtime for `rooms` and `room_players`.
4. In Project Settings > API copy the Project URL, anon/publishable key and service-role key.

## 2. Local setup
Copy `.env.example` to `.env.local` and fill in:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- ADMIN_USERNAME
- ADMIN_PASSWORD

Then:
```bash
npm install
npm run dev
```
Open http://localhost:3000.

## 3. Vercel
Push the folder to GitHub, import the repo in Vercel, and add the same environment variables in Vercel Project Settings > Environment Variables. Deploy. Vercel detects Next.js automatically.

## 4. Admin
Default credentials in the template are:
- Username: `admin`
- Password: `NepaliCardRoom!2026`

Change `ADMIN_PASSWORD` before sharing the site. Never put the Supabase service-role key in a `NEXT_PUBLIC_` variable.

## Rules implemented
- Teen Patti: 3 cards; trail, pure sequence, sequence, colour, pair, high card; blind/seen; boot; chaal; fold; showdown/winner logic.
- Kitti: 9 cards arranged as three 3-card hands; each hand follows the standard three-card ranking; majority of the three comparisons wins. Local variations can differ.
- Texas Hold'em: two hole cards, flop/turn/river, blinds, check/call/raise/fold, showdown using the best 5 of 7 cards.

This is a friends-only virtual-points project. It does not implement cash deposits, withdrawals or cash-equivalent redemption.
