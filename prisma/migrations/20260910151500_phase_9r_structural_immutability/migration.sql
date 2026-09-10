-- Fase 9R — correção focal pós-reauditoria (achado Médio: imutabilidade apenas em
-- aplicação, sem espelho no banco). Additive only — nenhuma migration anterior é
-- editada. Aplicar somente após backup real de dev e teste, com SHA-256 e restauração
-- verificados (ver outputs/backups/).
--
-- Segue o mesmo padrão de 20260905220000_phase_9p3a_immutable_signature_evidence:
-- BEFORE UPDATE OR DELETE por linha, BEFORE TRUNCATE por statement, RAISE EXCEPTION com
-- ERRCODE 23514 (check_violation). Diferença deliberada: as duas tabelas da 9R misturam
-- linhas terminais e não-terminais (mutáveis até a transição final), então o bloqueio de
-- UPDATE/DELETE é condicionado a OLD.status já ser terminal — permite as transições
-- legítimas anteriores ao estado terminal e a própria transição PARA o estado terminal
-- (a trigger só vê OLD; se OLD ainda não é terminal, a escrita passa). TRUNCATE é
-- bloqueado incondicionalmente, como no precedente.

CREATE FUNCTION rede_bank_financing_disbursement_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- TRUNCATE é um trigger de statement (sem OLD/NEW) — bloqueado incondicionalmente,
  -- igual ao precedente. UPDATE/DELETE só são bloqueados quando a linha já é terminal.
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'BANK_FINANCING_DISBURSEMENT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'RECONCILED' THEN
    RAISE EXCEPTION 'BANK_FINANCING_DISBURSEMENT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_financing_disbursement_immutable BEFORE UPDATE OR DELETE ON bank_financing_disbursements
FOR EACH ROW EXECUTE FUNCTION rede_bank_financing_disbursement_immutable();
CREATE TRIGGER bank_financing_disbursement_no_truncate BEFORE TRUNCATE ON bank_financing_disbursements
FOR EACH STATEMENT EXECUTE FUNCTION rede_bank_financing_disbursement_immutable();

CREATE FUNCTION rede_condominium_setup_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'CONDOMINIUM_SETUP_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('IMPLEMENTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'CONDOMINIUM_SETUP_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER condominium_setup_immutable BEFORE UPDATE OR DELETE ON condominium_setups
FOR EACH ROW EXECUTE FUNCTION rede_condominium_setup_immutable();
CREATE TRIGGER condominium_setup_no_truncate BEFORE TRUNCATE ON condominium_setups
FOR EACH STATEMENT EXECUTE FUNCTION rede_condominium_setup_immutable();
