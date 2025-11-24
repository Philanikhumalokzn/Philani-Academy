# Philani Academy - Current Site Overview

*Last Updated: November 24, 2024*

## Overview

Philani Academy is a Next.js-based educational platform designed for mathematics tutoring across grades 8-12. The site provides online learning sessions, student management, and subscription-based access to educational resources.

## Technology Stack

- **Framework**: Next.js 16.0.3 with TypeScript
- **Authentication**: NextAuth.js with credential-based login
- **Database**: PostgreSQL via Prisma ORM
- **Styling**: Tailwind CSS with custom design system
- **Real-time Features**: Ably for collaborative whiteboard
- **Video Conferencing**: Jitsi integration for live classes
- **Payment Processing**: Stripe & PayFast for subscriptions
- **Email**: Resend for verification codes and notifications
- **Hosting**: Vercel-ready deployment

## Design & Branding

### Color Scheme
- **Primary**: Deep navy blue (#0a1931) - professional and educational
- **Accent**: Cyan (#06B6D4) - modern and engaging
- **Background**: Light slate (#F8FAFC) for main content areas
- **Cards**: White (#FFFFFF) with subtle shadows

### Typography
- **Font Family**: Inter (Google Fonts) - modern, clean, and highly legible
- **Weights**: Regular (400), Semi-bold (600), Bold (700), Extra-bold (800)

### Visual Style
- Clean, modern interface with rounded corners (8-12px border radius)
- Soft shadows for depth (0 8px 24px rgba(10,25,49,0.06))
- Consistent spacing and padding
- Responsive grid layouts
- Mobile-first design approach

## Current Pages & Features

### 1. Navigation Bar
**Location**: Persistent across all pages

**Features**:
- Logo: "Philani Academy" branding on the left
- Center navigation: Dashboard, Subscribe links
- Right side: Sign in button (when logged out) or user profile (when logged in)
- Mobile responsive with hamburger menu
- Deep navy background with white text

### 2. Dashboard (Landing Page)
**URL**: `/dashboard` (redirected from `/`)

**When Not Signed In**:
- Overview section with two main cards:
  - **Grade workspace**: Prompts user to sign in to manage grades
  - **Account snapshot**: Shows "Not signed in" status
  - Quick action buttons: "Update profile" and "Manage subscription"
- Left sidebar navigation (desktop) or horizontal tabs (mobile) showing:
  - Overview (active by default for guests)
  - Other sections hidden for non-authenticated users
- Account status widget showing Role: guest, Grade: N/A

**When Signed In** (varies by role):

#### For Students/Teachers:
- **Overview Section**:
  - Grade workspace showing current grade assignment
  - Account snapshot with email, role, and grade
  - Quick links to other dashboard sections

- **Live Class Section**:
  - Embedded Jitsi video conferencing room
  - Grade-specific rooms (e.g., "philani-grade-8")
  - Collaborative math board powered by MyScript
  - Real-time synchronization across participants

- **Announcements Section**:
  - View grade-specific announcements
  - Timestamped updates from teachers/admins
  - Teachers can create new announcements

- **Sessions Section**:
  - View upcoming class sessions for assigned grade
  - Join links for each session (Teams, Zoom, Padlet, etc.)
  - Start time displayed in local timezone
  - Expandable lesson materials:
    - View/download PDFs, documents, presentations
    - File size and upload timestamp shown
    - Teachers can upload new materials

#### For Admins (Additional Features):
- **Grade Selection**: Can switch between all grades (8-12)
- **Users/Learners Section**:
  - View all registered users in a detailed table
  - User information includes:
    - Email and learner name
    - Role and grade assignment
    - Contact details (phone, alternate phone, recovery email)
    - Emergency contact information
    - Physical address
    - School name
    - Account creation date
  - Create new users with specific roles and grades
  - Delete user accounts

- **Billing Section**:
  - Create subscription plans
  - Set plan pricing (in cents, minimum R5.00 for PayFast)
  - Manage plan status (active/inactive)
  - Edit existing plans
  - Delete plans
  - Plans displayed with ZAR currency

### 3. Sign In Page
**URL**: `/auth/signin`

**Features**:
- Clean, centered form design
- Email and password fields
- "Sign in" button
- Link to signup page: "Don't have an account? Sign up"
- Email verification section:
  - For users who haven't verified their email
  - "Resend verification code" button
- White card on navy blue background
- Welcoming message: "Welcome back! Enter your credentials to access the dashboard."

### 4. Sign Up Page
**URL**: `/signup`

**Features**:
- Multi-step form with navigation arrows (Back/Next)
- "Client JS loaded ✔" indicator
- Three main sections:
  
  **Learner Details**:
  - First name field
  - Last name field
  - Grade dropdown (Grades 8-12)
  
  **Contact Details**:
  - Email address field
  - Mobile number field (South African format: 0821234567)
  
  **Security**:
  - Password field (minimum 8 characters)
  - POPIA privacy policy consent checkbox
  - Link to privacy policy page
  
- "Sign up" button
- Link to sign in: "Already registered? Sign in"
- Right-aligned form card on navy blue background

### 5. Subscribe Page
**URL**: `/subscribe`

**Features**:
- Simple centered layout
- Heading: "Subscribe to Philani Academy"
- Currently shows: "No subscription plans available. Contact admin."
- (Plans can be created by admins in the Dashboard → Billing section)

### 6. Profile Page
**URL**: `/profile`

**Features** (authenticated users only):
- Personal information management
- Grade assignment
- Contact details
- Password change option

### 7. Email Verification Page
**URL**: `/verify-email`

**Features**:
- 6-digit verification code entry
- Code expiry countdown (10 minutes default)
- Resend code option
- Auto-redirect after successful verification

## User Roles & Permissions

### Guest (Not Signed In)
- View: Dashboard overview only
- Cannot access: Live classes, sessions, announcements

### Student
- View: Assigned grade workspace
- Access: Live classes, announcements, session materials for their grade
- Cannot: Create sessions, manage users, view billing

### Teacher
- View: Assigned grade workspace
- Access: All student features
- Can: Create sessions, post announcements, upload materials
- Cannot: Manage users, create subscription plans

### Admin
- Full access to all features
- Can switch between all grades
- User management capabilities
- Billing and subscription plan management
- Can create teachers and students

## Technical Features

### Authentication & Security
- NextAuth.js credential-based authentication
- Email verification with 6-digit codes
- Optional phone verification support
- Password hashing with bcryptjs
- Admin bypass for email verification
- Session management with JWT

### Database Structure
- **User Model**: Comprehensive profile fields including emergency contacts, address
- **SessionRecord**: Class sessions with join URLs and materials
- **Announcement**: Grade-specific announcements
- **LessonMaterial**: File uploads with metadata (size, type, creator)
- **SubscriptionPlan**: PayFast/Stripe integration
- **ContactVerification**: Email/phone verification tokens

### Grade System
- Supports: Grade 8, 9, 10, 11, 12
- Enum-based for data consistency
- Grade-specific content isolation
- Dynamic grade selection for admins

### Real-time Collaboration
- Jitsi video conferencing integration
- MyScript math canvas for collaborative problem-solving
- Ably-powered real-time synchronization
- Grade-specific rooms

### File Management
- Lesson material uploads
- Supported formats: PDF, DOC, DOCX, PPT, PPTX, images, videos, ZIP
- Vercel Blob storage integration (production)
- Local storage fallback (development)
- File metadata tracking (size, type, uploader)

### Email System
- Resend API integration
- Verification code delivery
- Customizable sender address
- Admin invitation system
- Test email endpoint for debugging

## Responsive Design

### Desktop (>768px)
- Side navigation with descriptions
- Multi-column layouts
- Full-width tables
- Expanded forms

### Mobile (<768px)
- Horizontal scrolling tab navigation
- Stacked single-column layouts
- Condensed tables
- Full-width forms
- Hamburger menu for main navigation
- Centered hero content

## Deployment & Environment

### Development
- Local PostgreSQL database
- Hot module replacement (HMR)
- Prisma Studio for database management
- Environment variables from `.env`

### Production (Vercel)
- PostgreSQL database (external provider)
- Vercel Blob storage for uploads
- Environment variables configured in Vercel dashboard
- Automatic deployments from Git

## Key URLs & Navigation Flow

```
/ (index) → Redirects to → /dashboard
/dashboard → Main hub (varies by user role)
/api/auth/signin → /auth/signin (custom sign-in page)
/signup → Registration flow → /verify-email
/subscribe → View/purchase subscription plans
/profile → Update user profile
```

## Screenshots

The site has been captured in its current state showing:

1. **Dashboard (Not Signed In)**: Clean overview with grade workspace and account snapshot cards
2. **Sign In Page**: Centered form with email verification option
3. **Sign Up Page**: Comprehensive registration form with learner, contact, and security sections
4. **Subscribe Page**: Simple subscription management interface

## Current State Summary

Philani Academy is a **fully functional, production-ready educational platform** with:

✅ Complete authentication system with email verification  
✅ Role-based access control (Guest, Student, Teacher, Admin)  
✅ Grade-specific content management (Grades 8-12)  
✅ Live video conferencing integration  
✅ Collaborative math whiteboard  
✅ Session scheduling and material distribution  
✅ Announcement system  
✅ User management for admins  
✅ Subscription/billing management (PayFast & Stripe)  
✅ Responsive, modern UI with consistent branding  
✅ Database-backed with PostgreSQL  
✅ Ready for Vercel deployment  

The platform is designed as a comprehensive solution for online mathematics tutoring, combining video communication, document sharing, real-time collaboration, and administrative tools in a clean, professional interface.
