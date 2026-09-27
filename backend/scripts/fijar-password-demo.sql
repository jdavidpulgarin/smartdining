-- ==============================================================================
-- Deja a todos los usuarios demo del seed de Jarrison con la contraseña
-- Admin123!, para poder probar el login del backend en local.
--
-- El seed trae un password_hash que no corresponde a ninguna contraseña
-- conocida; este script lo reemplaza por el hash bcrypt de Admin123!.
--
-- Uso (desde backend/):
--   psql -h localhost -U postgres -d smartdining -f scripts/fijar-password-demo.sql
--
-- Está en un archivo .sql a propósito: el hash lleva '$' y se rompe al pasarlo
-- por -c desde la shell.
-- ==============================================================================

UPDATE usuarios
SET password_hash = '$2b$10$4PaqDdBb5R6V5Yu1t3LQiu9fDdwQ/wtILW/rcfAhvKJXTaKg6cmh2';

SELECT email, rol, activo FROM usuarios ORDER BY id_usuario;
