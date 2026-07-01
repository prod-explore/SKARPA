<div align="center">
  <h1>🧗Fantastyczne Wspinanie</h1>
  <p><strong>Climbing Class Registration & Management System</strong></p>

  [![Build Status](https://github.com/prod-explore/SKARPA/actions/workflows/ci.yml/badge.svg)](https://github.com/prod-explore/SKARPA/actions)
  [![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)](https://nodejs.org/)
  [![SQLite](https://img.shields.io/badge/SQLite-Fast-003B57.svg)](https://www.sqlite.org/)
</div>

## 📌 Overview

**Fantastyczne Wspinanie** is a secure, lightweight, and fast web application designed to manage complex registrations and attendance for climbing classes. Built as part of a structured program, it provides instructors with powerful tools to manage participant lists while offering a seamless registration experience for students and parents.

Unlike generic CMS solutions, this platform focuses heavily on **business logic tailored for sports facilities**: a dynamic class schedule, complex instructor-level permissions, and granular participant tracking.

---

## 🏗️ Architecture

The system is a monolith Node.js application built with Express, utilizing a local SQLite database for high-performance, low-overhead data management.

```mermaid
graph TD
    Client[Browser / Mobile] -->|HTTPS| Node[Express.js Application]
    
    subgraph Core System
        Node --> Auth[JWT Authentication]
        Node --> Views[EJS Templating Engine]
        Node --> DB[(Better-SQLite3 Database)]
        Node --> Email[Resend API]
    end
```

---

## ✨ Features

### 👨‍🏫 Instructor & Account Management
- **Role-Based Access Control (RBAC)**: Secure access tailored specifically for Instructors and Administrators via JWT tokens.
- **Granular Instructor Profiles**: Each instructor has a dedicated account with access strictly limited to their assigned classes.
- **Cross-List Permissions**: Advanced logic allows designated instructors (e.g., animation coordinators) to access specialized cross-lists while maintaining the security of primary climbing lists.

### 📅 Class Calendar & Scheduling
- **Dynamic Registration Schedules**: Automated class slots available for sign-ups based on day of the week, instructor availability, and class type (e.g., beginner, advanced, children's animations).
- **Attendance Tracking**: Real-time participant list management allowing instructors to quickly check in students directly from their mobile devices during classes.
- **Capacity Control**: Automatic caps on class sizes to prevent overbooking, ensuring a safe climbing environment.

### 🔒 Security & Operations
- **Automated Email Notifications**: Integration with the `Resend` API for transactional emails, registration confirmations, and important schedule changes.
- **Security Hardened**: Protected against common web vulnerabilities via `helmet`, `express-rate-limit`, and data validation (`validator`).
- **Server-Side Rendering**: Fast, SEO-friendly, and accessible views rendered natively via EJS.
- **Containerized**: Fully Dockerized for instant, reproducible deployments across any environment.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- Docker & Docker Compose (Optional, for containerized deployment)
- Resend API Key

### Installation (Local)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-org/skarpa-bytom.git
   cd skarpa-bytom
   ```

2. **Configure Environment Variables:**
   Copy the example environment file and fill in the values:
   ```bash
   cp .env.example .env
   ```
   *Make sure to set your `RESEND_API_KEY` and `JWT_SECRET`.*

3. **Install Dependencies:**
   ```bash
   npm install
   ```

4. **Run the Application:**
   ```bash
   npm start
   ```

### Installation (Docker)

```bash
docker-compose up --build -d
```
The application will be exposed on the port defined in your `docker-compose.yml`.

---

## 📂 Technical Stack

- **Backend framework**: Express.js
- **Database**: SQLite (via `better-sqlite3`)
- **Authentication**: JSON Web Tokens (`jsonwebtoken`)
- **Email Delivery**: Resend (`resend`)
- **Templating**: EJS
- **Security**: Helmet, Express Rate Limit, Cookie Parser

---
<div align="center">
  <i>Developed for Fantastyczne Wspinanie.</i>
</div>
