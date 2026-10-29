# Hisab Khata

Pao na dena hisab rakhar choto web app. Email ar password diye account khule login korte hoy; protita user shudhu nijer hishab dekhte pay. Data Firebase (Auth + Firestore) e thake, tai je kono device theke login korle eki hishab pawa jay.

## Ki ki kora jay
- Email/password diye **Register / Login**, password reset email
- Shob device e live sync, internet na thakleo kaj kore
- **Ami dibo / Ami pabo** entry jog kora (taka `4500`, `4k`, `3300+4000` shob vabe likha jay)
- Pura shodh (✓) ba **kichu shodh** (partial payment), baki nije hishab hoy
- Edit, delete, ar protita kaje **Undo**
- **Manush onujayi** tab: ekjon er sathe dibo/pabo duita thakle net koto
- Search, shodh hoye jawa entry lukano/dekhano
- CSV download, JSON backup/restore
- Dark mode, mobile e "Add to Home screen" kore app er moto chalano jay (PWA)

## Chalano
`index.html` browser e khulun, othoba GitHub Pages e chalun:
Settings → Pages → Source: *Deploy from a branch* → `main` / root.

## Security
`firestore.rules` er rule Firebase console e boshano: `users/{uid}` document shudhu oi user nijei porte/likhte pare.
`firebase-config.js` er value gulo public hobar jonnoi; data ke dekhbe ta rule thik kore.
