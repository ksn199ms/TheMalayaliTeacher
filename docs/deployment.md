# 🚀 TheMalayaliTeacher — Production Deployment Guide

This guide covers deploying **TheMalayaliTeacher** in production on a VPS (Ubuntu/Debian, CentOS, or Windows Server) or cloud platform (AWS EC2, DigitalOcean Droplet, Hetzner) natively using Node.js and PM2, with zero Docker dependencies.

---

## 1. Prerequisites

- **Node.js**: v20.x or v22.x LTS (`node -v` >= 20.0.0)
- **npm**: v10+
- **MongoDB**: MongoDB 6.0+ instance (Local service or [MongoDB Atlas Free/Dedicated Tier](https://www.mongodb.com/atlas))
- **Qdrant Vector Database**:
  - **Option A (Cloud - Recommended)**: [Qdrant Cloud Free/Managed Cluster](https://cloud.qdrant.io)
  - **Option B (Native Binary)**: Downloaded and run natively via `npm run qdrant:start`
- **Redis (Optional)**: Redis 7.x (Local service, [Upstash Serverless Redis](https://upstash.com), or [Redis Cloud](https://redis.io/cloud/)) — *in-memory fallback is automatically used if Redis is not configured*
- **Google Gemini API Key**: From [Google AI Studio](https://aistudio.google.com/)
- **Telegram Bot Token**: From [@BotFather](https://t.me/botfather)
- **Domain & SSL**: For Telegram webhook and REST API (Let's Encrypt / Certbot)

---

## 2. Server Setup & Preparation

### Install Node.js LTS (Ubuntu/Debian example)
```bash
# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential

# Verify versions
node -v
npm -v
```

### Install PM2 Globally
PM2 ensures zero-downtime restarts, process monitoring, and automatic recovery on system reboots:
```bash
sudo npm install -g pm2
```

---

## 3. Clone Repository & Install Dependencies

```bash
# Clone your repository
git clone https://github.com/<your-username>/TheMalayaliTeacher.git
cd TheMalayaliTeacher

# Install production dependencies
npm ci

# Build TypeScript to production JavaScript
npm run build
```

---

## 4. Production Environment Configuration

Copy the production environment template:
```bash
cp .env.production.example .env
```

Edit `.env` using your preferred editor (`nano .env`):
```env
# Application Environment
NODE_ENV=production
PORT=5000

# Security & CORS
CORS_ORIGIN=https://themalayaliteacher.yourdomain.com
JWT_SECRET=your_super_long_random_64_character_production_secret_key!
JWT_EXPIRES_IN=7d

# Databases
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.mongodb.net/the-malayali-teacher?retryWrites=true&w=majority
QDRANT_URL=https://<your-cluster-id>.qdrant.tech:6333
QDRANT_COLLECTION=student_documents

# AI Provider (Google Gemini)
AI_PROVIDER=gemini
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_EMBEDDING_MODEL=gemini-embedding-001

# Telegram Bot
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRstUVwxyz
TELEGRAM_MODE=webhook # Set to 'webhook' for production or 'polling' for simple setups
TELEGRAM_WEBHOOK_URL=https://themalayaliteacher.yourdomain.com

# Storage
STORAGE_PROVIDER=local
STORAGE_LOCAL_DIR=./storage

# Redis & Worker (Optional)
REDIS_URL=redis://localhost:6379
ENABLE_BACKGROUND_WORKER=true
```

---

## 5. Running with PM2

Start the application with PM2:
```bash
pm2 start dist/server.js --name "the-malayali-teacher" --time
```

Enable PM2 to restart automatically on server boot:
```bash
pm2 startup
pm2 save
```

### Managing the Process
```bash
# View real-time status
pm2 status

# View live application logs
pm2 logs the-malayali-teacher

# Restart service after updates
pm2 restart the-malayali-teacher

# Monitor CPU and memory usage
pm2 monit
```

---

## 6. Nginx Reverse Proxy & SSL Setup

Install Nginx and Certbot:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Configure Nginx site `/etc/nginx/sites-available/themalayaliteacher`:
```nginx
server {
    listen 80;
    server_name themalayaliteacher.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 30M;
    }
}
```

Enable configuration and generate SSL certificate:
```bash
sudo ln -s /etc/nginx/sites-available/themalayaliteacher /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d themalayaliteacher.yourdomain.com
```

---

## 7. Health & Readiness Verification

Verify the server is running healthy:
```bash
# Health check
curl https://themalayaliteacher.yourdomain.com/health

# Readiness check (DB & Qdrant connectivity)
curl https://themalayaliteacher.yourdomain.com/ready
```

Expected response:
```json
{"status":"ok","timestamp":"2026-09-23T15:00:00.000Z"}
```
