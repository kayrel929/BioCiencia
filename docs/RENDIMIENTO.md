# Rendimiento

Mediciones **reales** de la Fase 11 con `npm run test:perf` (archivo `tests/perf/rendimiento.perf.test.ts`).
Los datos de la medición son sintéticos (no son publicaciones reales) y solo sirven para medir volumen.

**Máquina:** nube de desarrollo, Intel Xeon 2,1 GHz, 2 núcleos, 8 GB, Node 22.22, SQLite en memoria (adaptador de Node).
La versión web usa SQLite en WebAssembly con OPFS y la de Windows usa SQLite nativo en disco: los tiempos en su PC serán distintos.
Para medir en su computadora: `npm.cmd run test:perf` (crea `tests/perf/resultado.json`).

| Prueba | Cantidad | Tiempo | Límite de la prueba |
| --- | --- | ---: | ---: |
| Guardar publicaciones en la biblioteca | 5 000 | 6,6 s | 60 s |
| Búsqueda de texto completo (promedio por consulta) | 50 consultas sobre 5 000 | 28 ms | 250 ms |
| Abrir la biblioteca (primera página) | 5 000 | 14 ms | 1 s |
| Crear copia de seguridad | 5 000 publicaciones | 53 ms | 10 s |
| Cifrar copia (9,7 MB, PBKDF2 600 000) | 1 copia | 0,7 s | 20 s |
| Restaurar copia de seguridad | 5 000 publicaciones | 5,6 s | 60 s |
| Firmar eventos (Ed25519) | 2 000 | 0,4 s | 30 s |
| Verificar firmas | 2 000 | 0,5 s | 30 s |
| Reproducir un proyecto compartido | 2 000 eventos | 15 ms | 5 s |
| ANOVA de una vía + Tukey | 20 000 datos, 20 tratamientos | 76 ms | 5 s |
| Procesar citas APA | 2 000 citas, 500 referencias | 44 ms | 5 s |
| Generar Word (.docx) | 4 000 párrafos + 500 referencias (1,3 MB) | 34 ms | 5 s |

Pendiente: medir en la PC del usuario (web con OPFS y app Windows).
