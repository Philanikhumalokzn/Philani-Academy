# Discover Button Analysis - Dashboard

## Question
**"Does our site have a discover button on dashboard?"**

## Answer: YES ✅

The Philani Academy dashboard **DOES have a Discover button**.

---

## Evidence

### 1. Dashboard Sections Configuration
Location: `/pages/dashboard.tsx` (Line 34-43)

The Discover section is defined in the `DASHBOARD_SECTIONS` array:

```typescript
const DASHBOARD_SECTIONS = [
  { id: 'overview', label: 'Overview', description: 'Grade & quick actions', roles: ['admin', 'teacher', 'student', 'guest'] },
  { id: 'live', label: 'Live Class', description: 'Join lessons & board', roles: ['admin', 'teacher', 'student'] },
  { id: 'announcements', label: 'Announcements', description: 'Communicate updates', roles: ['admin', 'teacher', 'student'] },
  { id: 'sessions', label: 'Sessions', description: 'Schedule classes & materials', roles: ['admin', 'teacher', 'student'] },
  { id: 'groups', label: 'Groups', description: 'Classmates & groupmates', roles: ['admin', 'teacher', 'student'] },
  { id: 'discover', label: 'Discover', description: 'Find people & join groups', roles: ['admin', 'teacher', 'student'] },  // ← HERE
  { id: 'users', label: 'Learners', description: 'Manage enrolments', roles: ['admin'] },
  { id: 'billing', label: 'Billing', description: 'Subscription plans', roles: ['admin'] }
] as const
```

### 2. Button Properties
- **ID**: `discover`
- **Label**: `Discover` (displayed to users)
- **Description**: `Find people & join groups`
- **Available to roles**: 
  - ✅ Admin
  - ✅ Teacher
  - ✅ Student
  - ❌ Guest (not included)

### 3. Button Rendering
Location: `/pages/dashboard.tsx` (Lines 5664-5723)

The `SectionNav` component automatically renders buttons for all available sections:

**Desktop View** (Large screens):
```typescript
<div className="hidden lg:grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
  {availableSections.map(section => (
    <button key={section.id} type="button" onClick={...}>
      <div className="text-sm font-semibold tracking-wide uppercase">
        {section.label}  {/* Shows "DISCOVER" */}
      </div>
      <div className="text-xs opacity-70">
        {section.description}  {/* Shows "Find people & join groups" */}
      </div>
    </button>
  ))}
</div>
```

**Mobile View** (Small screens):
```typescript
<div className="lg:hidden grid grid-cols-2 gap-3">
  {availableSections.map(section => (
    <button key={section.id} type="button" className="...">
      {section.label}  {/* Shows "Discover" */}
    </button>
  ))}
</div>
```

### 4. Discover Functionality
Location: `/pages/dashboard.tsx` (Lines 5596-5654)

When the Discover button is clicked, it opens an overlay with:
- **Search input**: Search by name, email, or school
- **Search button**: Triggers the search
- **Results display**: Shows user profiles with avatars, names, and bios
- **User links**: Click on any user to view their profile

```typescript
case 'discover':
  return (
    <div className="space-y-3">
      <section className="card p-3 space-y-3">
        <div className="text-sm font-semibold text-white">Discover</div>
        <div className="flex items-center gap-2">
          <input
            className="input flex-1"
            placeholder="Search by name, email, or school"
            value={discoverQuery}
            onChange={(e) => setDiscoverQuery(e.target.value)}
          />
          <button type="button" className="btn btn-secondary">
            {discoverLoading ? 'Searching…' : 'Search'}
          </button>
        </div>
        {/* Results display */}
      </section>
    </div>
  )
```

### 5. API Endpoints
The Discover feature is backed by these API endpoints:

- `/api/discover/users` - Search for users
- `/api/discover/user/[id]` - Get user profile details

These endpoints are confirmed to exist in the build output.

---

## Visual Location

### Desktop Dashboard
On desktop/laptop screens (≥1024px width), the Discover button appears as:
- A **card-style button** in a responsive grid
- Shows **"DISCOVER"** label (uppercase)
- Shows **"Find people & join groups"** description
- Located among other section buttons (Overview, Live Class, Announcements, Sessions, Groups, Discover, etc.)

### Mobile Dashboard
On mobile screens (<1024px width), the Discover button appears as:
- A **compact button** in a 2-column grid
- Shows **"Discover"** label only
- Takes up one cell in the grid layout

---

## How to Access

1. **Log in** to your Philani Academy account
2. Navigate to the **Dashboard** page
3. The **Discover** button will be visible in the section navigation
4. Click the **Discover** button to:
   - Search for other users
   - Find people to connect with
   - Join groups
   - View user profiles

---

## Role-Based Visibility

| User Role | Can See Discover Button? |
|-----------|-------------------------|
| Admin     | ✅ Yes                   |
| Teacher   | ✅ Yes                   |
| Student   | ✅ Yes                   |
| Guest     | ❌ No                    |

---

## Summary

✅ **Yes, the site has a Discover button on the dashboard.**

The button is:
- Properly configured in the code
- Automatically rendered by the navigation system
- Fully functional with search capabilities
- Available to all authenticated users (admin, teacher, student)
- Connected to working API endpoints
- Part of the core dashboard navigation

No changes are needed - the feature already exists and is working as designed.
