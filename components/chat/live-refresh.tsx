"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Refresco del chat con Supabase Realtime (Fase 6). Solo se monta si
 * `NEXT_PUBLIC_CHAT_REALTIME` es "true". Escucha los INSERT de `messages` de
 * esta conversación (Supabase aplica la RLS de lectura a cada suscriptor: un
 * tercero no recibe nada) y, ante cualquiera, vuelve a pedir la página al
 * servidor: el contenido siempre sale del servidor, nunca del evento. Si
 * Realtime no está disponible, no hace nada y queda «Actualizar».
 */
export function ChatLiveRefresh({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, router]);
  return null;
}
