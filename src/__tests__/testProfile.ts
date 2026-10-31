import type { ResearcherProfile } from '../types/simulation';

/** Валідний профіль: проходить isResearcherProfile. */
export const TEST_PROFILE: ResearcherProfile = {
  id: 'test-profile-1',
  displayName: 'Тестовий Дослідник',
  createdAt: '2026-10-31T10:00:00.000Z',
  lastLoginAt: '2026-10-31T10:00:00.000Z',
  theme: 'light',
};