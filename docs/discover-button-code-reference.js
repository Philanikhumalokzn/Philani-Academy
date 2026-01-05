/**
 * DISCOVER BUTTON - CODE REFERENCE
 * =================================
 * 
 * This file shows the exact locations in the codebase where the Discover button
 * is defined and rendered on the dashboard.
 */

// FILE: /pages/dashboard.tsx

// ============================================================================
// 1. SECTION DEFINITION (Lines 34-43)
// ============================================================================
// The Discover section is defined in the DASHBOARD_SECTIONS array

const DASHBOARD_SECTIONS = [
  { id: 'overview', label: 'Overview', description: 'Grade & quick actions', roles: ['admin', 'teacher', 'student', 'guest'] },
  { id: 'live', label: 'Live Class', description: 'Join lessons & board', roles: ['admin', 'teacher', 'student'] },
  { id: 'announcements', label: 'Announcements', description: 'Communicate updates', roles: ['admin', 'teacher', 'student'] },
  { id: 'sessions', label: 'Sessions', description: 'Schedule classes & materials', roles: ['admin', 'teacher', 'student'] },
  { id: 'groups', label: 'Groups', description: 'Classmates & groupmates', roles: ['admin', 'teacher', 'student'] },
  
  // ✅ DISCOVER SECTION - THIS IS THE DISCOVER BUTTON DEFINITION
  { id: 'discover', label: 'Discover', description: 'Find people & join groups', roles: ['admin', 'teacher', 'student'] },
  
  { id: 'users', label: 'Learners', description: 'Manage enrolments', roles: ['admin'] },
  { id: 'billing', label: 'Billing', description: 'Subscription plans', roles: ['admin'] }
] as const

// ============================================================================
// 2. ROLE-BASED FILTERING (Lines 1873-1876)
// ============================================================================
// Sections are filtered based on the user's role

const availableSections = useMemo(
  () => DASHBOARD_SECTIONS.filter(section => 
    (section.roles as ReadonlyArray<SectionRole>).includes(normalizedRole)
  ),
  [normalizedRole]
)

// If user role is 'admin', 'teacher', or 'student', the Discover section will be included.
// If user role is 'guest', it will be filtered out.

// ============================================================================
// 3. BUTTON RENDERING - DESKTOP (Lines 5669-5694)
// ============================================================================
// Desktop view shows label + description in a card-style button

<div className="hidden lg:grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
  {availableSections.map(section => {
    const isActive = section.id === 'overview' ? activeSection === 'overview' : dashboardSectionOverlay === section.id
    return (
      <button
        key={section.id}
        type="button"
        onClick={() => {
          if (section.id === 'overview') {
            closeDashboardOverlay()
            return
          }
          openDashboardOverlay(section.id as OverlaySectionId)
        }}
        className={`rounded-2xl border px-4 py-3 text-left transition focus:outline-none focus:ring-2 ${
          isActive
            ? 'border-blue-500 bg-white text-slate-900 shadow-lg focus:ring-blue-200'
            : 'border-white/10 bg-white/5 text-white/80 hover:border-white/30 focus:ring-white/10'
        }`}
      >
        {/* ✅ DISCOVER BUTTON LABEL - Shows "DISCOVER" */}
        <div className="text-sm font-semibold tracking-wide uppercase">{section.label}</div>
        
        {/* ✅ DISCOVER BUTTON DESCRIPTION - Shows "Find people & join groups" */}
        <div className="text-xs opacity-70">{section.description}</div>
      </button>
    )
  })}
</div>

// ============================================================================
// 4. BUTTON RENDERING - MOBILE (Lines 5696-5720)
// ============================================================================
// Mobile view shows label only in a compact 2-column grid

<div className="lg:hidden grid grid-cols-2 gap-3">
  {availableSections.map(section => {
    const isActive = section.id === 'overview' ? activeSection === 'overview' : dashboardSectionOverlay === section.id
    return (
      <button
        key={section.id}
        type="button"
        onClick={() => {
          if (section.id === 'overview') {
            closeDashboardOverlay()
            return
          }
          openDashboardOverlay(section.id as OverlaySectionId)
        }}
        className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 ${
          isActive
            ? 'bg-white text-[#04123b] border-white focus:ring-white/40 shadow-lg'
            : 'bg-white/10 border-white/20 text-white focus:ring-white/20'
        }`}
      >
        {/* ✅ DISCOVER BUTTON LABEL - Shows "Discover" */}
        {section.label}
      </button>
    )
  })}
</div>

// ============================================================================
// 5. DISCOVER CONTENT RENDERING (Lines 5596-5654)
// ============================================================================
// When the Discover button is clicked, this content is displayed

case 'discover':
  return (
    <div className="space-y-3">
      <section className="card p-3 space-y-3">
        <div className="text-sm font-semibold text-white">Discover</div>
        <div className="flex items-center gap-2">
          {/* Search input */}
          <input
            className="input flex-1"
            placeholder="Search by name, email, or school"
            value={discoverQuery}
            onChange={(e) => setDiscoverQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void searchDiscover(discoverQuery)
              }
            }}
          />
          {/* Search button */}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={discoverLoading || (discoverQuery.trim().length > 0 && discoverQuery.trim().length < 2)}
            onClick={() => void searchDiscover(discoverQuery)}
          >
            {discoverLoading ? 'Searching…' : 'Search'}
          </button>
        </div>
        {discoverError && <div className="text-sm text-red-200">{discoverError}</div>}

        {/* Search results */}
        {discoverResults.length > 0 && (
          <div className="grid gap-2">
            {discoverResults.map((u: any) => (
              <UserLink
                key={u.id}
                userId={u?.id}
                className="card p-3 text-left block"
                title="View profile"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl border border-white/15 bg-white/5 overflow-hidden flex items-center justify-center text-white/90">
                    {u.avatar ? (
                      <img src={u.avatar} alt={u.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-sm font-semibold">{String(u.name || 'U').slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white truncate">{u.name}</div>
                    <div className="text-xs muted truncate">{u.schoolName ? `${u.schoolName} • ` : ''}{u.statusBio || ''}</div>
                  </div>
                </div>
              </UserLink>
            ))}
          </div>
        )}
      </section>
    </div>
  )

// ============================================================================
// 6. API ENDPOINTS (Built and Ready)
// ============================================================================

// The Discover feature is backed by these API endpoints:

// GET /api/discover/users
// - Search for users by name, email, or school
// - Query parameter: ?q=searchTerm
// - Returns: Array of user objects

// GET /api/discover/user/[id]
// - Get detailed profile information for a specific user
// - Returns: User profile object

// ============================================================================
// SUMMARY
// ============================================================================

/**
 * ✅ The Discover button EXISTS and is FULLY FUNCTIONAL
 * 
 * Location: Dashboard section navigation
 * Visibility: Admin, Teacher, Student roles
 * Label: "DISCOVER" (desktop) / "Discover" (mobile)
 * Description: "Find people & join groups"
 * Functionality: Opens search overlay to find and connect with users
 * 
 * To access:
 * 1. Log in to Philani Academy
 * 2. Go to Dashboard
 * 3. Look for the "Discover" button in the section navigation
 * 4. Click to search for users
 */
