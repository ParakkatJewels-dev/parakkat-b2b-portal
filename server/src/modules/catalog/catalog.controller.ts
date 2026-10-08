import type { Request, Response } from 'express';
import { ApiError } from '../../utils/apiError';
import * as catalogService from './catalog.service';

export async function resorts(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ resorts: await catalogService.listResorts() });
}

/** Dateless room-catalog browse (room-first flow). */
export async function browse(req: Request, res: Response): Promise<void> {
  if (!req.user!.agencyId) throw ApiError.forbidden('Only agency users can browse');
  res.status(200).json({ rooms: await catalogService.browseRooms(req.user!.agencyId) });
}

export async function availability(req: Request, res: Response): Promise<void> {
  if (!req.user!.agencyId) throw ApiError.forbidden('Only agency users can search');
  const q = req.query as unknown as {
    resortId: string;
    checkIn: string;
    checkOut: string;
    guests: number;
    adults?: number;
    children?: number;
    childAges?: number[];
    extraBeds?: number;
  };
  const roomTypes = await catalogService.searchAvailability(q, req.user!.agencyId);
  res.status(200).json({ roomTypes });
}

/** Admin read-through of CRS rates/restrictions for a resort + date range. */
export async function axisRates(req: Request, res: Response): Promise<void> {
  const { resortId, checkIn, checkOut } = req.query as { resortId?: string; checkIn: string; checkOut: string };
  res.status(200).json(await catalogService.getAxisRatesOverview(resortId, checkIn, checkOut));
}

/** Admin read-only catalog of CRS resorts + room types. */
export async function adminCatalog(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await catalogService.getAdminCatalog());
}
