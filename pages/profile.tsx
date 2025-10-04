import React, { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

export default function ProfilePage() {
  const { data: session } = useSession()
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [avatar, setAvatar] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  useEffect(() => { fetchProfile() }, [])

  async function fetchProfile() {
    setLoading(true)
    try {
      const res = await fetch('/api/profile', { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        setProfile(data)
        setName(data.name || '')
        setPhone(data.phone || '')
        setAvatar(data.avatar || '')
      }
    } catch (e) {
    } finally { setLoading(false) }
  }

  async function save() {
    try {
      const res = await fetch('/api/profile', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, phone, avatar }) })
      if (res.ok) {
        alert('Profile updated')
        fetchProfile()
      } else {
        const d = await res.json().catch(() => ({}))
        alert(d?.message || 'Failed')
      }
    } catch (e: any) { alert(e?.message || 'Network error') }
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">My profile</h1>
        {loading ? <div>Loading…</div> : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm">Name</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm">Phone</label>
              <input className="input" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm">Avatar URL</label>
              <input className="input" value={avatar} onChange={e => setAvatar(e.target.value)} />
              <div className="mt-2">Preview: {avatar ? <img src={avatar} alt="avatar" style={{ width: 64, height: 64, borderRadius: 8 }} /> : <span className="muted">No avatar</span>}</div>
            </div>
            <div>
              <button className="btn btn-primary" onClick={save}>Save</button>
            </div>
            <div className="pt-6 border-t">
              <h3 className="font-medium mb-2">Change password</h3>
              <div className="space-y-2">
                <input className="input" placeholder="Current password" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
                <input className="input" placeholder="New password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                <div>
                  <button className="btn btn-secondary" onClick={async () => {
                    if (!currentPassword || !newPassword) { alert('Fill both fields'); return }
                    setChangingPassword(true)
                    try {
                      const res = await fetch('/api/profile/change-password', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) })
                      if (res.ok) { alert('Password changed'); setCurrentPassword(''); setNewPassword('') } else { const d = await res.json().catch(()=>({})); alert(d?.message || 'Failed to change password') }
                    } catch (e: any) { alert(e?.message || 'Network error') }
                    setChangingPassword(false)
                  }}>{changingPassword ? 'Changing…' : 'Change password'}</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
