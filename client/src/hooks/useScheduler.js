/**
 * Client-side scheduled post runner.
 * Every 60 seconds, checks Firestore for posts with status='scheduled' and scheduledAt <= now.
 * For each due post, calls the appropriate publish endpoint and updates the post status.
 * Works as long as the browser tab is open — supplements the server cron job.
 */
import { useEffect, useRef } from 'react';
import { auth } from '../firebase';
import { getPosts, updatePost } from '../services/firestore';
import { api } from './useAuth';

const POLL_INTERVAL_MS = 60_000;

export function useScheduler(integrations = []) {
  const integrationsRef = useRef(integrations);
  useEffect(() => { integrationsRef.current = integrations; }, [integrations]);

  useEffect(() => {
    let timer;

    const runDuePosts = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      let scheduled;
      try {
        scheduled = await getPosts(uid, { status: 'scheduled', limit: 50 });
      } catch {
        return;
      }

      const now = Date.now();
      const due = scheduled.filter((p) => {
        const t = p.scheduledAt ? new Date(p.scheduledAt).getTime() : null;
        return t && t <= now;
      });

      for (const post of due) {
        try {
          const platforms = post.platforms || [];
          if (platforms.length === 0) continue;

          const endpoint = post.imageUrl ? '/posts/image' : '/posts';
          const body = {
            content: post.content,
            platforms,
            integrations: integrationsRef.current,
          };
          if (post.imageUrl) body.imageUrl = post.imageUrl;

          const res = await api(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (res.ok) {
            await updatePost(uid, post._id || post.id, {
              status: 'published',
              publishedAt: new Date(),
            }).catch(() => {});
            console.log(`[scheduler] Published due post ${post._id}`);
          }
        } catch (err) {
          console.warn(`[scheduler] Failed to publish post ${post._id}:`, err.message);
        }
      }
    };

    const schedule = () => {
      runDuePosts().catch(() => {});
      timer = setTimeout(schedule, POLL_INTERVAL_MS);
    };

    // Start after initial short delay so auth is ready
    const initial = setTimeout(schedule, 5_000);
    return () => {
      clearTimeout(initial);
      clearTimeout(timer);
    };
  }, []);
}
