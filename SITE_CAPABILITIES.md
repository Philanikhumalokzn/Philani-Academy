# What Our Site Currently Does

## Overview
Philani Academy for Mathematics is a comprehensive online learning platform built with Next.js. It provides a complete ecosystem for mathematics education with live classes, collaboration tools, user management, and subscription billing.

## Core Capabilities

### 1. User Authentication & Account Management
- **Secure Sign-up & Sign-in**: NextAuth-based authentication with credential provider
- **Email Verification**: 6-digit verification codes sent via Resend API
  - 10-minute token validity (configurable via `EMAIL_VERIFICATION_TOKEN_TTL_MS`)
  - Admin accounts can bypass verification
  - Users can resend verification codes if needed
- **Role-Based Access Control**: Four user roles with distinct permissions:
  - **Admin**: Full system access, can manage all grades, users, sessions, and billing
  - **Teacher**: Can create sessions, upload materials, and manage announcements for their grade
  - **Student**: Can view sessions, materials, and announcements for their assigned grade
  - **Guest**: Limited access (browse only)
- **User Profiles**: Comprehensive profile management including:
  - Personal information (name, date of birth, ID number)
  - Contact details (phone, alternate phone, recovery email)
  - Emergency contact information
  - Physical address
  - School name
  - Avatar upload support

### 2. Grade-Based Workspace System
- **Multi-Grade Support**: Manages separate workspaces for Grades 8-12
- **Grade Assignment**: Students and teachers are assigned to specific grades
- **Admin Grade Switching**: Admins can switch between grades to manage content for different levels
- **Isolated Content**: Sessions, announcements, and materials are grade-specific

### 3. Live Class Features
- **Jitsi Video Conferencing**: Integrated Jitsi Meet for real-time video classes
  - Grade-specific virtual rooms
  - JWT token authentication for secure access
  - Optional JAAS (Jitsi as a Service) integration
  - Self-hosted Jitsi support available
  - Automatic owner/moderator privileges for admins and teachers
- **Collaborative Math Board**: Real-time collaborative whiteboard using MyScript
  - Handwriting recognition for mathematical equations
  - Multi-user collaboration via Ably realtime messaging
  - Grade-specific board rooms
  - Persistent canvas state

### 4. Session Management
- **Session Creation**: Teachers and admins can create scheduled sessions with:
  - Title and description
  - Join URL (Teams, Zoom, Padlet, or other platforms)
  - Start date/time
  - Grade assignment
- **Session Listing**: Grade-filtered view of upcoming sessions
- **Lesson Materials**: Upload and manage learning resources
  - Multiple file format support (PDF, DOC, PPT, images, videos, ZIP)
  - File metadata tracking (size, content type, upload time)
  - Download access for students
  - Teacher/admin deletion capabilities

### 5. Announcements System
- **Grade-Specific Announcements**: Teachers and admins can post updates
- **Announcement Management**: Create, view, and delete announcements
- **Timestamp Tracking**: All announcements show creation date and author
- **Content Formatting**: Supports multi-line text content

### 6. User Management (Admin Only)
- **User Creation**: Admins can create new users with:
  - Name, email, password
  - Role assignment
  - Grade assignment (for students and teachers)
- **User Listing**: Comprehensive table view showing:
  - Basic account info (email, name, role, grade)
  - Contact information
  - Emergency contacts
  - Address details
  - Account creation date
- **User Deletion**: Remove user accounts when needed

### 7. Subscription & Billing
- **PayFast Integration**: South African payment gateway support
  - Subscription plan creation and management
  - Onsite payment tokens for inline checkout
  - Webhook handling for payment notifications
  - ZAR currency support
  - Minimum amount validation (R5.00 minimum)
- **Stripe Integration**: Alternative payment processor
  - Checkout session creation
  - Webhook handling
- **Plan Management**: Admins can:
  - Create subscription plans with custom pricing
  - Edit plan details (name, amount, active status)
  - Delete plans
  - Toggle plan availability

### 8. Database & Data Management
- **PostgreSQL Database**: Production-ready database via Prisma ORM
- **Data Models**:
  - Users with comprehensive profile fields
  - Session records with materials
  - Announcements
  - Subscription plans
  - Contact verification tokens
- **Data Relationships**: Proper foreign key constraints and cascading deletes
- **Migrations**: Version-controlled database schema changes

### 9. File Storage
- **Vercel Blob Storage**: For lesson material uploads in production
- **Local Fallback**: Writes to `public/materials` during development
- **Multiple File Types**: Supports documents, presentations, spreadsheets, images, videos, and archives

### 10. Email Communications
- **Resend API Integration**: Professional email delivery service
- **Verification Emails**: Automated 6-digit code delivery
- **Domain Management**: CLI tool for managing sender domains (`npm run resend:domains`)
- **Test Mode**: Optional email testing endpoint for development

### 11. Security Features
- **Password Hashing**: bcryptjs for secure password storage
- **JWT Tokens**: For session authentication and Jitsi room access
- **Email Verification**: Required for new signups (with admin bypass)
- **HTTPS Support**: Production-ready security configuration
- **Environment Variables**: Sensitive data protection via .env files
- **Policy Consent**: Tracks user consent to terms and policies

### 12. Developer Experience
- **TypeScript**: Full type safety throughout the application
- **Hot Reload**: Fast development with Next.js dev server
- **Database Studio**: Prisma Studio for visual database management
- **Seeding**: Automated admin account creation
- **Tailwind CSS**: Utility-first styling framework
- **Responsive Design**: Mobile-friendly layouts

## Technical Stack
- **Frontend**: Next.js (React), TypeScript, Tailwind CSS
- **Backend**: Next.js API routes, NextAuth
- **Database**: PostgreSQL with Prisma ORM
- **Real-time**: Ably for collaborative features
- **Video**: Jitsi Meet (JAAS or self-hosted)
- **Payments**: PayFast (primary) and Stripe
- **Email**: Resend API
- **Storage**: Vercel Blob
- **Hosting**: Vercel-optimized deployment

## Deployment Options
- **Vercel**: Primary deployment platform with automatic builds
- **Database**: Supabase, Railway, or any PostgreSQL provider
- **Storage**: Vercel Blob for production file uploads
- **Environment Configuration**: Comprehensive .env variable support

## Current Limitations & Notes
- Prototype stage - requires production hardening for scaling
- Phone verification infrastructure present but not fully implemented
- Some features require environment variable configuration
- PayFast subscription minimum: R5.00 (500 cents)
- Email delivery requires Resend API key in production

## User Workflows

### Student Workflow
1. Sign up with email and password
2. Verify email with 6-digit code
3. View dashboard with assigned grade workspace
4. Join live classes via Jitsi
5. Collaborate on math board
6. View upcoming sessions
7. Download lesson materials
8. Read grade-specific announcements
9. Manage subscription

### Teacher Workflow
1. Admin creates teacher account with grade assignment
2. Teacher verifies email and signs in
3. Switch to assigned grade workspace
4. Create scheduled sessions
5. Upload lesson materials
6. Post announcements
7. Join and moderate live classes
8. Collaborate with students on math board

### Admin Workflow
1. Sign in with admin credentials
2. Switch between grades to manage content
3. Create and manage users
4. Create sessions and upload materials for all grades
5. Post announcements across grades
6. Manage subscription plans
7. View comprehensive user information
8. Monitor system activity

## Privacy & Compliance
- Privacy notice available at `/privacy`
- User consent tracking for policies
- Comprehensive personal data fields
- Emergency contact storage
- Data export capabilities via Prisma

This platform provides a complete solution for online mathematics education, combining live instruction, collaboration tools, content management, and subscription billing in a single integrated system.
