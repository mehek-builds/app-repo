import { applicantEmailForGeneratedPacket } from './applicant-email';
import type { ApplicationProfile, GeneratedResume, Profile } from './types';

export function frozenApplicantFillData(packet: GeneratedResume): {
  profile: Profile;
  applicationProfile: ApplicationProfile;
} | null {
  const snapshot = packet.applicant_snapshot;
  const frozenEmail = applicantEmailForGeneratedPacket(packet);
  if (!snapshot || !frozenEmail) return null;
  const profile = snapshot.profile;
  const applicationProfile = snapshot.application_profile;
  if (!profile
    || !applicationProfile
    || typeof profile !== 'object'
    || typeof applicationProfile !== 'object'
    || !Array.isArray(profile.experience)
    || !Array.isArray(profile.skills)
    || typeof profile.full_name !== 'string'
    || !profile.full_name.trim()
    || typeof profile.email !== 'string'
    || profile.email.trim().toLowerCase() !== frozenEmail
    || (typeof profile.currently_enrolled === 'boolean'
      && typeof applicationProfile.currently_enrolled === 'boolean'
      && profile.currently_enrolled !== applicationProfile.currently_enrolled)) return null;
  return { profile, applicationProfile };
}
