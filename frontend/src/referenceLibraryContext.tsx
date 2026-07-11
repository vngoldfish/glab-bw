import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  addReferenceFromPath,
  deleteReferenceRecord,
  fetchReferenceLibrary,
  mapReferenceRecord,
  replaceReferenceImage,
  updateReferenceRecord,
  uploadReferenceImages,
} from "./api";
import type { NamedReference, ReferenceCategory } from "./types";

interface ReferenceLibraryContextValue {
  library: NamedReference[];
  folder: string;
  maxItems: number;
  loading: boolean;
  refresh: () => Promise<void>;
  addReferences: (files: File[]) => Promise<NamedReference[]>;
  addReferenceFromAppPath: (filePath: string, label: string, category: string) => Promise<NamedReference>;
  updateReference: (
    id: string,
    patch: Partial<Pick<NamedReference, "name" | "label" | "category">>,
  ) => Promise<void>;
  replaceImage: (id: string, file: File) => Promise<void>;
  removeReference: (id: string) => Promise<void>;
}

const ReferenceLibraryContext = createContext<ReferenceLibraryContextValue | null>(null);

export function ReferenceLibraryProvider({ children }: { children: ReactNode }) {
  const [library, setLibrary] = useState<NamedReference[]>([]);
  const [folder, setFolder] = useState("G-Labs BW/reference_images");
  const [maxItems, setMaxItems] = useState(100);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await fetchReferenceLibrary();
    setLibrary(data.references.map(mapReferenceRecord));
    setFolder(data.folder);
    setMaxItems(data.max_items);
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [refresh]);

  const addReferences = useCallback(async (files: File[]) => {
    const created = await uploadReferenceImages(files);
    const mapped = created.map(mapReferenceRecord);
    setLibrary((prev) => [...prev, ...mapped]);
    return mapped;
  }, []);

  const addReferenceFromAppPath = useCallback(async (filePath: string, label: string, category: string) => {
    const created = await addReferenceFromPath(filePath, label, category);
    const mapped = mapReferenceRecord(created);
    setLibrary((prev) => [...prev, mapped]);
    return mapped;
  }, []);

  const updateReference = useCallback(
    async (
      id: string,
      patch: Partial<Pick<NamedReference, "name" | "label" | "category">>,
    ) => {
      const updated = await updateReferenceRecord(id, patch);
      const mapped = mapReferenceRecord(updated);
      setLibrary((prev) => prev.map((item) => (item.id === id ? mapped : item)));
    },
    [],
  );

  const replaceImage = useCallback(async (id: string, file: File) => {
    const updated = await replaceReferenceImage(id, file);
    const mapped = mapReferenceRecord(updated);
    setLibrary((prev) => prev.map((item) => (item.id === id ? mapped : item)));
  }, []);

  const removeReference = useCallback(async (id: string) => {
    await deleteReferenceRecord(id);
    setLibrary((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      library,
      folder,
      maxItems,
      loading,
      refresh,
      addReferences,
      addReferenceFromAppPath,
      updateReference,
      replaceImage,
      removeReference,
    }),
    [
      library,
      folder,
      maxItems,
      loading,
      refresh,
      addReferences,
      addReferenceFromAppPath,
      updateReference,
      replaceImage,
      removeReference,
    ],
  );

  return (
    <ReferenceLibraryContext.Provider value={value}>{children}</ReferenceLibraryContext.Provider>
  );
}

export function useReferenceLibrary(): ReferenceLibraryContextValue {
  const ctx = useContext(ReferenceLibraryContext);
  if (!ctx) {
    throw new Error("useReferenceLibrary must be used within ReferenceLibraryProvider");
  }
  return ctx;
}

export type { ReferenceCategory };