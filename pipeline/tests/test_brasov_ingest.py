from mdu.adapters.brasov.ingest import debate_records
from mdu.core.streets import StreetIndex, StreetPoint
from mdu.fixtures import fixture_bytes
from mdu.ingest import IngestStats, SourceDoc, looks_personal, looks_private_home, slug_for


def listing() -> SourceDoc:
    return SourceDoc(
        "https://www.brasovcity.ro/consiliul-local/proiecte-de-hotarare-dezbatere-publica",
        200,
        fixture_bytes("brasov", "council_debates/listing"),
        "text/html",
    )


def test_only_urban_plans_with_mapped_statuses_become_projects() -> None:
    stats = IngestStats()
    records = debate_records(listing(), StreetIndex({}), stats)
    assert 10 <= len(records) <= 30
    assert {r.kind for r in records} <= {"puz", "pud"}
    assert {r.status for r in records} <= {
        "approved",
        "in_public_consultation",
        "withdrawn",
        "rejected",
    }
    assert stats.skipped_other.get("not an urban plan (PUZ/PUD)", 0) > 50
    for r in records:
        assert not r.title.lower().startswith("proiect")
        assert r.official_title.lower().startswith("proiect")
        assert r.event_type == "consultation_opened"
        assert r.documents
        assert all(d.url.startswith("https://www.brasovcity.ro/") for d in r.documents)
        assert r.street is None  # empty index


def test_slugs_are_stable_unique_and_free_of_folder_names() -> None:
    records = debate_records(listing(), StreetIndex({}), IngestStats())
    slugs = [r.slug for r in records]
    assert len(set(slugs)) == len(slugs)
    assert slugs == [r.slug for r in debate_records(listing(), StreetIndex({}), IngestStats())]
    for r in records:
        folder = r.private_key.split(":", 1)[1].lower()
        assert folder not in r.slug


def test_streets_in_titles_are_located() -> None:
    plain = debate_records(listing(), StreetIndex({}), IngestStats())
    # Build an index from whatever streets the titles mention, then expect matches.
    probe = StreetIndex({})
    names = {m for r in plain for m in probe.mentions(r.official_title)}
    index = StreetIndex(
        {n: StreetPoint(n, 25.6, 45.65) for n in (" ".join(m.split()) for m in names)}
    )
    located = debate_records(listing(), index, IngestStats())
    assert sum(r.street is not None for r in located) >= len(plain) // 2


def test_personal_data_wording_and_slugs() -> None:
    assert looks_personal("PUD locuință, beneficiar Ion Popescu")
    assert looks_personal("Construire locuință - persoană fizică")
    assert not looks_personal("P.U.Z. Construire locuințe colective, str. Lungă nr. 5")
    assert looks_personal("PUD locuință str. Lungă nr. 5 - inițiator Ion Popescu")
    assert not looks_personal("PUZ centru de îngrijire - inițiator Fundația Exemplu")
    assert not looks_personal("PUZ zonă comercială, inițiator SC Exemplu Retail SRL")
    assert not looks_personal("PUZ locuințe, beneficiari SC Exemplu SRL și SC Altul SRL")
    assert looks_personal("PUD casă, beneficiari Ion și Maria Popescu")
    assert looks_personal("PUD, beneficiar: SC Exemplu SRL, proprietar Ion Popescu")
    assert slug_for("P.U.D. Construire showroom auto", "notice:1").startswith(
        "construire-showroom-auto-"
    )
    assert slug_for("P.U.D. Construire showroom auto", "notice:1") != slug_for(
        "P.U.D. Construire showroom auto", "notice:2"
    )


def test_single_private_homes_are_recognised() -> None:
    assert looks_private_home("P.U.D. Edificare locuință unifamilială, împrejmuire, str. X nr. 8")
    assert looks_private_home("Elaborare PUD pentru CONSTRUIRE LOCUINTA CU REGIM DE INALTIME S+P+E")
    assert looks_private_home("PUD casă P+1, str. Y nr. 3")
    assert not looks_private_home("PUZ Construire locuințe colective și spații comerciale")
    assert not looks_private_home("PUZ Lotizare locuinte individuale")
    assert not looks_private_home("P.U.D. Construire sediu birouri cu parter comercial P+2")
    assert not looks_private_home("PUD Casa de cultură a sindicatelor")
