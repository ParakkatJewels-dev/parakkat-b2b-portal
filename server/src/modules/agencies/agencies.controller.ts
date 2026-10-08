import type { Request, Response } from 'express';
import * as agenciesService from './agencies.service';

export async function list(req: Request, res: Response): Promise<void> {
  const page = Number(req.query.page ?? 1);
  const pageSize = Math.min(Number(req.query.pageSize ?? 20), 100);
  const result = await agenciesService.listAgencies({ page, pageSize });
  res.status(200).json(result);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const agency = await agenciesService.getAgencyById(req.params.id);
  res.status(200).json(agency);
}

/** An agency user's own profile + commercial terms + documents. */
export async function myProfile(req: Request, res: Response): Promise<void> {
  res.status(200).json(await agenciesService.getMyAgencyProfile(req.user!.agencyId!));
}

export async function getResaleMarkup(req: Request, res: Response): Promise<void> {
  res.status(200).json(await agenciesService.getMyResaleMarkup(req.user!.agencyId!));
}

export async function updateResaleMarkup(req: Request, res: Response): Promise<void> {
  const { resaleMarkupPct } = req.body as { resaleMarkupPct: number };
  res.status(200).json(await agenciesService.updateMyResaleMarkup(req.user!.agencyId!, resaleMarkupPct));
}

export async function getDetail(req: Request, res: Response): Promise<void> {
  const agency = await agenciesService.getAgencyDetail(req.params.id);
  res.status(200).json(agency);
}

export async function update(req: Request, res: Response): Promise<void> {
  const agency = await agenciesService.updateAgency(req.params.id, req.body, {
    actorId: req.user!.id,
    actorRole: req.user!.role,
  });
  res.status(200).json(agency);
}

export async function suspend(req: Request, res: Response): Promise<void> {
  const agency = await agenciesService.suspendAgency(req.params.id, {
    actorId: req.user!.id,
    actorRole: req.user!.role,
  });
  res.status(200).json(agency);
}

export async function reactivate(req: Request, res: Response): Promise<void> {
  const agency = await agenciesService.reactivateAgency(req.params.id, {
    actorId: req.user!.id,
    actorRole: req.user!.role,
  });
  res.status(200).json(agency);
}

export async function create(req: Request, res: Response): Promise<void> {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const registrationProof = files?.['registrationProof']?.[0];
  const addressProof = files?.['addressProof']?.[0];

  const docs = {
    registrationProof: registrationProof
      ? {
          buffer: registrationProof.buffer,
          originalname: registrationProof.originalname,
          mimetype: registrationProof.mimetype,
        }
      : undefined,
    addressProof: addressProof
      ? {
          buffer: addressProof.buffer,
          originalname: addressProof.originalname,
          mimetype: addressProof.mimetype,
        }
      : undefined,
  };

  const agency = await agenciesService.createAgency(req.body, docs, {
    actorId: req.user!.id,
    actorRole: req.user!.role,
  });
  res.status(201).json(agency);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const result = await agenciesService.deleteAgency(req.params.id, {
    actorId: req.user!.id,
    actorRole: req.user!.role,
  });
  res.status(200).json(result);
}

export async function updateCommercialConfig(req: Request, res: Response): Promise<void> {
  const configuration = await agenciesService.updateAgencyCommercialConfig(
    req.params.id,
    req.body.tier,
    {
      actorId: req.user!.id,
      actorRole: req.user!.role,
    },
    { markupPct: req.body.markupPct },
  );
  res.status(200).json(configuration);
}
