# TB Betong – Trimble Connect extension (1277 Jåtunparken)

Extension for 3D-visningen i Trimble Connect (Total Betong). Samme kode gir **to ikoner**:

| Ikon | Manifest-URL | Inndeling |
|---|---|---|
| TB Betong PK | `https://totalbetong1234.github.io/tc-betong-jatun/manifest-pk.json` | PK → elementtype → type |
| TB Betong Konstruksjon | `https://totalbetong1234.github.io/tc-betong-jatun/manifest-konstruksjon.json` | Elementtype → PK → type |

## Installasjon
Prosjekt → **Innstillinger** → **Extensions** (Apps & Capabilities) → **+ Add Custom** → lim inn én av URL-ene over. Gjenta for den andre.

## Elementtyper (RefCompClass)
AHE Punktfundamenter · AHF Sålefundamenter · ASA Søyler · AVA Yttervegger · AVB Innervegger · ABA Bjelker · ADA Dekker · AOA Gulv

## Mengder
- Volum = `Volume`. **Gulv (AOA): GrossArea × 0,12 m** (endres under Innstillinger).
- Areal = `areal`; gulv bruker `GrossArea`.
- Status fra `Støpe Dato`: dato t.o.m. i dag = **støpt** (grønn), frem i tid = **planlagt** (rød), tom = **gjenstår** (blå).
- `Byggningsdel` = Endringsarbeider ligger i sin PK, merket **E** og summert som «herav endringsarbeider».

## Annet (støy)
Flyttes automatisk til «Annet»:
- Mangler RefCompClass («--» eller «.»), f.eks. ROOF TRP 200 og prosjektnullpunkt.
- Proxy-objekter (IfcBuildingElementProxy), f.eks. ARB.
- Type/navn med PREFAB, Steinull, EPS, XPS, Isolasjon.
- Stål: materiale S235/S355 …, «Stål», «Steel» eller «Metal».

## Funksjoner
- **Valgt i modellen**: m³, m², antall og status for det som er markert (oppdateres når utvalget endres) + **CSV**.
- **Stamp label**: én etikett per valgt element med «type · m³» (maks 150), 2 m over elementet.
- Per gruppe: **Velg**, **Isoler**, **Farge status**, **CSV**.
- Liste per type: klikk, **Ctrl+klikk**, **Shift+klikk** for flervalg.
- **Farge status** (hele modellen) og **Nullstill**.
- CSV: semikolon, desimalkomma, UTF-8 – åpnes direkte i Excel. Filnavn `1277_Jåtunparken_<gruppe>_<dato>.csv`.

## Data
All behandling skjer i nettleseren via Trimble Connect Workspace API. Ingen data sendes til andre servere.

## Versjoner
- v0.1.0 – første versjon.
