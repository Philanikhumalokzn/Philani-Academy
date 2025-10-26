import React, { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'

export default function ProfilePage() {
  const { data: session } = useSession()
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [race, setRace] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [birthDate, setBirthDate] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState('')
  const [phones, setPhones] = useState<any[]>([])
  const [tp, setTp] = useState<any>({}) // teacher profile
  const [saving, setSaving] = useState(false)

  // camera capture state
  const [cameraOpen, setCameraOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
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
        setBio(data.bio || '')
        setRace(data.race || '')
        setIdNumber(data.idNumber || '')
        setBirthDate(data.birthDate ? new Date(data.birthDate).toISOString().slice(0,10) : null)
        setAvatarUrl(data.avatarUrl || '')
        setPhones(Array.isArray(data.phoneNumbers) ? data.phoneNumbers : [])
        setTp(data.teacherProfile || {})
      }
    } catch (e) {
    } finally { setLoading(false) }
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/profile', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, bio, race, idNumber, avatarUrl, phoneNumbers: phones, teacherProfile: (session?.user as any)?.role === 'admin' || (session?.user as any)?.role === 'teacher' ? tp : undefined }) })
      if (res.ok) {
        alert('Profile updated')
        fetchProfile()
      } else {
        const d = await res.json().catch(() => ({}))
        alert(d?.message || 'Failed')
      }
    } catch (e: any) { alert(e?.message || 'Network error') } finally { setSaving(false) }
  }

  async function uploadAvatarFromFile(file: File) {
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const res = await fetch('/api/profile/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: reader.result }) })
        if (res.ok) { const d = await res.json(); setAvatarUrl(d.avatarUrl) } else { const d = await res.json().catch(()=>({})); alert(d?.message || 'Upload failed') }
      } catch (e: any) { alert(e?.message || 'Upload error') }
    }
    reader.readAsDataURL(file)
  }

  async function openCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraOpen(true)
    } catch (e: any) { alert('Unable to access camera: ' + (e?.message || '')) }
  }

  function closeCamera() {
    setCameraOpen(false)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  async function capturePhoto() {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/png')
    try {
      const res = await fetch('/api/profile/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: dataUrl }) })
      if (res.ok) { const d = await res.json(); setAvatarUrl(d.avatarUrl); closeCamera() } else { const d = await res.json().catch(()=>({})); alert(d?.message || 'Upload failed') }
    } catch (e: any) { alert(e?.message || 'Upload error') }
  }

  function addPhone() {
    setPhones(p => [...p, { id: undefined, number: '', label: '', isPrimary: p.length === 0 }])
  }

  function removePhone(idx: number) {
    setPhones(p => p.filter((_, i) => i !== idx))
  }

  function markPrimary(idx: number) {
    setPhones(p => p.map((x, i) => ({ ...x, isPrimary: i === idx })))
  }

  async function sendCode(idx: number) {
    const pn = phones[idx]
    if (!pn?.number) { alert('Enter phone number first'); return }
    const res = await fetch('/api/profile/phone/start-verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phoneId: pn.id, number: pn.number, label: pn.label }) })
    if (res.ok) { const d = await res.json(); if (d.debugCode) alert('Dev code: ' + d.debugCode); alert('Code sent') } else { const d = await res.json().catch(()=>({})); alert(d?.message || 'Failed to send') }
  }

  async function confirmCode(idx: number, code: string) {
    const pn = phones[idx]
    if (!pn?.id) { alert('Save profile first so the phone is created'); return }
    const res = await fetch('/api/profile/phone/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phoneId: pn.id, code }) })
    if (res.ok) { alert('Phone verified'); fetchProfile() } else { const d = await res.json().catch(()=>({})); alert(d?.message || 'Invalid code') }
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">My profile</h1>
        {loading ? <div>Loading…</div> : (
          <div className="space-y-4">
            {/* Avatar */}
            <div>
              <label className="block text-sm">Avatar</label>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded overflow-hidden bg-gray-100 flex items-center justify-center">
                  {avatarUrl ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" /> : <span className="text-xs text-gray-500">No avatar</span>}
                </div>
                <div className="flex items-center gap-2">
                  <label className="btn btn-secondary">
                    <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatarFromFile(f) }} />
                    Upload
                  </label>
                  <button className="btn" onClick={openCamera}>Use camera</button>
                </div>
              </div>
              {cameraOpen && (
                <div className="mt-2 p-3 border rounded">
                  <video ref={videoRef} className="w-full" />
                  <div className="mt-2 flex gap-2">
                    <button className="btn btn-primary" onClick={capturePhoto}>Capture</button>
                    <button className="btn" onClick={closeCamera}>Close</button>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm">Name</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm">Bio</label>
              <textarea className="input min-h-[96px]" value={bio} onChange={e => setBio(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm">Race</label>
                <select className="input" value={race} onChange={e => setRace(e.target.value)}>
                  <option value="">Select…</option>
                  <option>Black</option>
                  <option>Coloured</option>
                  <option>Indian</option>
                  <option>White</option>
                  <option>Asian</option>
                  <option>Other</option>
                  <option>PreferNotToSay</option>
                </select>
              </div>
              <div>
                <label className="block text-sm">ID Number</label>
                <input className="input" value={idNumber} onChange={e => setIdNumber(e.target.value)} placeholder="13-digit South African ID" />
                {birthDate && <p className="text-xs text-gray-500 mt-1">Derived birthday: {birthDate}</p>}
              </div>
            </div>

            {/* Phone Numbers */}
            <div className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium">Contact numbers</h3>
                <button className="btn btn-secondary" onClick={addPhone}>Add number</button>
              </div>
              <div className="space-y-3">
                {phones.map((p, idx) => (
                  <div key={idx} className="p-3 border rounded">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
                      <input className="input sm:col-span-2" placeholder="Phone number" value={p.number || ''} onChange={e => setPhones(list => list.map((x, i) => i === idx ? { ...x, number: e.target.value } : x))} />
                      <input className="input" placeholder="Label (e.g. Mobile)" value={p.label || ''} onChange={e => setPhones(list => list.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))} />
                      <div className="flex items-center gap-2">
                        <input type="radio" name="primaryPhone" checked={!!p.isPrimary} onChange={() => markPrimary(idx)} />
                        <span className="text-sm">Primary</span>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`text-xs ${p.verified ? 'text-green-600' : 'text-gray-500'}`}>{p.verified ? 'Verified' : 'Not verified'}</span>
                      <button className="btn" onClick={() => sendCode(idx)}>Send code</button>
                      <VerifyInline onVerify={(code) => confirmCode(idx, code)} />
                      <button className="btn btn-danger ml-auto" onClick={() => removePhone(idx)}>Remove</button>
                    </div>
                  </div>
                ))}
                {phones.length === 0 && <div className="text-sm text-gray-500">No phone numbers added yet.</div>}
              </div>
            </div>

            {/* Teacher/Admin extra fields */}
            {(((session?.user as any)?.role === 'admin') || ((session?.user as any)?.role === 'teacher')) && (
              <div className="pt-4 border-t">
                <h3 className="font-medium mb-2">Teacher details</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm">Title</label>
                    <input className="input" value={tp.title || ''} onChange={e => setTp((s: any) => ({ ...s, title: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm">Subjects</label>
                    <input className="input" placeholder="e.g. Math, Physics" value={tp.subjects || ''} onChange={e => setTp((s: any) => ({ ...s, subjects: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm">Experience (years)</label>
                    <input className="input" type="number" min={0} value={tp.experienceYears ?? ''} onChange={e => setTp((s: any) => ({ ...s, experienceYears: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="block text-sm">Qualifications</label>
                    <input className="input" value={tp.qualifications || ''} onChange={e => setTp((s: any) => ({ ...s, qualifications: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm">Website</label>
                    <input className="input" value={tp.website || ''} onChange={e => setTp((s: any) => ({ ...s, website: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm">Twitter</label>
                    <input className="input" value={tp.twitter || ''} onChange={e => setTp((s: any) => ({ ...s, twitter: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm">LinkedIn</label>
                    <input className="input" value={tp.linkedin || ''} onChange={e => setTp((s: any) => ({ ...s, linkedin: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm">Office hours</label>
                    <input className="input" placeholder="e.g. Mon–Fri 14:00–16:00" value={tp.officeHours || ''} onChange={e => setTp((s: any) => ({ ...s, officeHours: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}
            <div>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
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

function VerifyInline({ onVerify }: { onVerify: (code: string) => void }) {
  const [code, setCode] = useState('')
  return (
    <span className="inline-flex items-center gap-2">
      <input className="input w-28" placeholder="Code" value={code} onChange={e => setCode(e.target.value)} />
      <button className="btn" onClick={() => onVerify(code)}>Confirm</button>
    </span>
  )
}
