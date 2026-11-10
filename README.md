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

## Egne egenskaper fra Trimble Connect
`PK Koder`, `Fremdrift` (Støpe Dato) og `Byggningsdel` er lagt til i Trimble Connect – ikke i IFC-filen. Panelet henter dem fra Trimble Connect sin Property Set-tjeneste (pset-api, Europa først):
- Første gang ber Trimble deg **godkjenne tilgang** for extensionen (bruker din innlogging; ingen nøkler i koden).
- Elementer kobles via IFC-GUID (`frn:entity:<GUID>`).
- Panelet oppdager selv hvilke egenskapssett som finnes og henter alle verdier samlet.
- **Innstillinger → Diagnose** viser hvert steg (token, region, sett, antall verdier som er flettet inn).

## Hurtigminne og oppdatering
Panelet lagrer det som er lest i nettleseren din (localStorage), så neste åpning går raskt:
- **IFC-data og GUID** lagres per modellversjon. Laster du en ny versjon av modellen, leses den automatisk på nytt.
- **PK / Støpe Dato / Byggningsdel** lagres med tidspunkt (vises over knappene).
- **Oppdater PK / Støpe Dato** – henter nyeste verdier fra Trimble Connect (rask: bruker lagret modell, GUID og oppsett).
- **Les modellen på nytt** – leser alt på nytt (tar tid). Brukes hvis noe ser feil ut.
Hurtigminnet gjelder bare din nettleser/PC; andre brukere bygger sitt eget første gang.

## Mengder
- Volum = `Volume`. **Gulv (AOA): GrossArea × 0,12 m** (endres under Innstillinger).
- Areal = `areal`; gulv bruker `GrossArea`.
- Status fra `Støpe Dato`: dato t.o.m. i dag = **støpt** (grønn), frem i tid = **planlagt** (rød), tom = **gjenstår** (blå).
- `Byggningsdel` = Endringsarbeider ligger i sin PK, merket **E** og summert som «herav endringsarbeider».

## Stål (egen gruppe)
- **Stålplater**: proxy-objekter (IfcBuildingElementProxy), f.eks. ARB.
- **Stålsøyler / Stålbjelker / Annet stål**: materiale S235/S355 …, «Stål», «Steel», «Metal», eller stålprofil i type/navn (HUP, KFHUP, VKR, RHS, SHS, CHS, HEA/HEB/HEM, IPE, UNP, UPE, L-profil).
- Stål sjekkes før prefab-regelen, så stålsøyler havner ikke i «Prefab og isolasjon».

## Annet (støy)
- Mangler RefCompClass («--» eller «.»), f.eks. ROOF TRP 200 og prosjektnullpunkt.
- Type/navn med PREFAB, Steinull, EPS, XPS, Isolasjon.

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
- v0.4.0 – hurtigminne (IFC/GUID per modellversjon, PK/Støpe Dato med tidspunkt), knappene «Oppdater PK / Støpe Dato» og «Les modellen på nytt», raskere GUID-henting.
- v0.3.0 – henter PK Koder, Støpe Dato og Byggningsdel fra Trimble Connect (pset-api) med brukerens tilgangstoken; egne sider pk.html/konstruksjon.html; diagnose.
- v0.2.0 – egen Stål-gruppe (plater, søyler, bjelker), stålprofiler gjenkjennes, Farge status mer robust med diagnose.
- v0.1.0 – første versjon.
