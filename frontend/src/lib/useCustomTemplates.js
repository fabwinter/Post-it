import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

// Designs converted from an uploaded PPTX/PDF/image (see Designs.jsx).
// Shared between the Designs page (list/convert/delete) and the Composer
// (pick one to drive "Build whole post").
export function useCustomTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    return api.get("/templates/custom")
      .then(({ data }) => setTemplates(data))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { templates, loading, reload };
}
