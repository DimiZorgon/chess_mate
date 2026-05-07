# Chess Mate

Application web d'échecs multijoueur en temps réel avec authentification persistante.

## Installation

À la racine du projet :

```bash
npm install
```

Puis démarre le client et le serveur :

```bash
npm run client
npm run server
```

## Cloudflare D1

Le backend stocke les comptes persistants dans une base Cloudflare D1. Copie `.env.example` en `.env` et renseigne :

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_NAME`
- `CLOUDFLARE_API_TOKEN`

## Structure

- `client/`: application React + Vite
- `server/`: backend Node.js + Express + Socket.IO

## Fonctionnalités

- connexion / inscription persistantes
- mode invité instantané
- création et jointure de salons
- synchronisation des coups en temps réel
- chronométrage côté serveur
- déconnexion gérée comme forfait
