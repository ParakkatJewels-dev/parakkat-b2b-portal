import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { getRealtimeChannels, isRealtimeEnabled } from '../../lib/realtime';

export const realtimeRouter = Router();

realtimeRouter.get('/config', authenticate, (req, res) => {
  const user = req.user!;
  res.json({
    enabled: isRealtimeEnabled(),
    channels: getRealtimeChannels(user.role, user.agencyId),
  });
});
