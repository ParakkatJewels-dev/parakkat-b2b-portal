import axios from 'axios';
import type {
  Application,
  DocType,
  DocumentSummary,
  DraftFields,
} from '../types/onboarding';

// Public onboarding uses its own axios instance — no bearer token and no
// 401-refresh interceptor (a bad resume token is a real 401, not an expired
// session to refresh).
const baseURL = '/api'; // same-origin: the API is part of this Next.js app

const publicClient = axios.create({
  baseURL,
});

function tokenHeader(resumeToken: string) {
  return { headers: { 'x-resume-token': resumeToken } };
}

export async function createDraft(
  fields: DraftFields,
): Promise<{ applicationId: string; resumeToken: string; application: Application }> {
  const res = await publicClient.post('/onboarding/applications', fields);
  return res.data;
}

export async function getDraft(
  applicationId: string,
  resumeToken: string,
): Promise<{ application: Application }> {
  const res = await publicClient.get(
    `/onboarding/applications/${applicationId}`,
    tokenHeader(resumeToken),
  );
  return res.data;
}

export async function updateDraft(
  applicationId: string,
  resumeToken: string,
  fields: DraftFields,
): Promise<{ application: Application }> {
  const res = await publicClient.patch(
    `/onboarding/applications/${applicationId}`,
    fields,
    tokenHeader(resumeToken),
  );
  return res.data;
}

export async function submitApplication(
  applicationId: string,
  resumeToken: string,
): Promise<{ applicationId: string; lifecycleState: string; submittedAt: string }> {
  const res = await publicClient.post(
    `/onboarding/applications/${applicationId}/submit`,
    {},
    tokenHeader(resumeToken),
  );
  return res.data;
}

export async function uploadDocument(
  applicationId: string,
  resumeToken: string,
  docType: DocType,
  file: File,
): Promise<DocumentSummary> {
  const form = new FormData();
  form.append('docType', docType);
  form.append('file', file);
  const res = await publicClient.post(
    `/onboarding/applications/${applicationId}/documents`,
    form,
    { headers: { 'x-resume-token': resumeToken } },
  );
  return res.data;
}

export async function listDocuments(
  applicationId: string,
  resumeToken: string,
): Promise<{ documents: DocumentSummary[] }> {
  const res = await publicClient.get(
    `/onboarding/applications/${applicationId}/documents`,
    tokenHeader(resumeToken),
  );
  return res.data;
}
