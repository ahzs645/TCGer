import { API_BASE_URL } from "./base-url";
import type { BinderPage, UpsertBinderPageInput } from "@tcg/api-types";

export async function saveBinderPage(
  token: string,
  binderId: string,
  input: UpsertBinderPageInput,
  photo?: Blob,
): Promise<BinderPage> {
  const path = `${API_BASE_URL}/collections/${encodeURIComponent(binderId)}/pages/${input.pageNumber}`;
  const response = await fetch(path, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok)
    throw new Error(
      "Could not save the binder page. Your review is still available to retry.",
    );
  let page = (await response.json()) as BinderPage;
  if (photo) {
    const form = new FormData();
    form.append("image", photo, "binder-page.jpg");
    const upload = await fetch(`${path}/image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!upload.ok)
      throw new Error(
        "Page saved, but its photo could not be saved. Retry to replace the photo.",
      );
    page = (await upload.json()) as BinderPage;
  }
  return page;
}

export async function getBinderPages(
  token: string,
  binderId: string,
): Promise<BinderPage[]> {
  const response = await fetch(
    `${API_BASE_URL}/collections/${encodeURIComponent(binderId)}/pages`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error("Could not load saved binder pages");
  return response.json();
}
