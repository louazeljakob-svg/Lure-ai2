Attribute VB_Name = "modPlacementNEMA"
'==============================================================================
'  modPlacementNEMA.bas - Placement des raccords NEMA sur un disjoncteur
'------------------------------------------------------------------------------
'  Projet CATVBA (CATIA V5, atelier Assembly Design).
'  Ce module contient tout le calcul. La fenêtre frmPlacementNEMA l'utilise.
'  Lancement : macro CATMain de ce module.
'
'  Règles :
'   - un raccord par publication "Face NEMA n" du disjoncteur ;
'   - pour chaque raccord : 1 coïncidence Face NEMA.1 <-> Face NEMA n, puis
'     1 coïncidence par axe publié du raccord : Axe NEMA.k <-> Axe NEMA n.k
'     (correspondance directe, comme sur le dessin). Le nombre de contraintes
'     dépend donc du raccord, pas du disjoncteur ;
'   - les nouveaux raccords sont de nouvelles instances de la même référence
'     (pièce de catalogue) : seul le nom d'instance est fixé, jamais le
'     PartNumber ;
'   - si le disjoncteur n'est pas fixé, une contrainte Fixe est ajoutée par
'     protection. On demande ensuite à l'utilisateur s'il faut la supprimer.
'
'  La macro ne modifie jamais les CATPart. Elle travaille seulement dans le
'  CATProduct (instances, positions, contraintes) et ne sauvegarde jamais.
'
'  Repère « A CONFIRMER » : appel dont je ne suis pas sûr à 100 %.
'==============================================================================
Option Explicit

'------------------------------------------------------------------------------
'  PARAMÈTRES PAR DÉFAUT (les cinq premiers se changent aussi dans la fenêtre)
'------------------------------------------------------------------------------
Public Const VERSION_OUTIL As String = "1.0"

' TABLE_AXES : correspondance entre les axes du raccord et les trous de la plage.
'   La k-ième valeur est le numéro j du trou "Axe NEMA n.j" qui reçoit le
'   k-ième axe du raccord ("Axe NEMA.k").
'   Vide = correspondance directe, comme sur le dessin :
'   Axe NEMA.1 -> Axe NEMA n.1, Axe NEMA.2 -> Axe NEMA n.2, etc.
'   Exemple pour forcer d'autres trous : "3,4,5,6".
Public Const TABLE_AXES As String = ""

' MODE_CONTRAINTES :
'   "COMPLET" : Face NEMA.1 + TOUS les axes publiés du raccord (règle par défaut).
'               ATTENTION : des axes parallèles coïncidents sont redondants entre
'               eux. CATIA peut alors signaler une surcontrainte (contrainte en
'               jaune ou en rouge) même si la position est bonne. Dans ce cas,
'               passer en "EXEMPLE".
'   "EXEMPLE" : Face NEMA.1 + seulement les axes listés dans AXES_MODE_EXEMPLE.
Public Const MODE_CONTRAINTES As String = "COMPLET"
Public Const AXES_MODE_EXEMPLE As String = "1,2"

' ORIENTATION_FACE (coïncidence Face NEMA.1 <-> Face NEMA n) :
'   "AUTO"   : déduite de la position après le prépositionnement, contrôlée après
'              la mise à jour et inversée si le raccord s'est retourné.
'   "OPPOSE" : catCstOrientOpposite (sens opposé).
'   "MEME"   : catCstOrientSame (même sens).
Public Const ORIENTATION_FACE As String = "AUTO"

' ROTATION_180 : True = tourne le raccord de 180° sur sa plage en inversant la
'   table des axes (1,2,3,4 devient 4,3,2,1). À utiliser si le raccord sort du
'   mauvais côté.
Public Const ROTATION_180 As Boolean = False

' IGNORER_FACES_DEJA_EQUIPEES : True = une face déjà citée par une contrainte ne
'   reçoit pas de nouveau raccord. La macro peut être relancée sans doublon.
Public Const IGNORER_FACES_DEJA_EQUIPEES As Boolean = True

Public Const PREPOSITIONNER As Boolean = True          ' déplacer le raccord avant de contraindre
Public Const PASSER_EN_MODE_CONCEPTION As Boolean = True
Public Const TOLERANCE_MM As Double = 0.2              ' contrôle de la position finale (mm)
Public Const TOLERANCE_MOTIF_MM As Double = 0.5        ' comparaison des entraxes (mm)
Public Const INDICE_MAX As Long = 12                   ' n, j, k testés de 1 à INDICE_MAX (20 au plus)
Public Const PROFONDEUR_MAX As Long = 4                ' profondeur de recherche dans l'arbre

' Noms des publications
Public Const PUB_FACE_DISJ As String = "Face NEMA "    ' + n             -> Face NEMA 1
Public Const PUB_AXE_DISJ As String = "Axe NEMA "      ' + n & "." & j   -> Axe NEMA 1.1
Public Const PUB_FACE_RAC As String = "Face NEMA.1"
Public Const PUB_AXE_RAC As String = "Axe NEMA."       ' + k             -> Axe NEMA.1
Public Const PUB_CABLE_RAC As String = "Point CABLE.1"

' Valeurs numériques des énumérations CATIA (ordre de V5Automation).
' En VBA, les noms (catCstTypeOn...) ne sont connus que si les bibliothèques
' CATIA sont référencées dans le projet : on utilise donc les valeurs.
' À confirmer avec Inspecter_Contraintes.CATScript, section 1.
Private Const CST_TYPE_FIXE As Long = 0              ' catCstTypeReference
Private Const CST_TYPE_COINCIDENCE As Long = 2       ' catCstTypeOn
Private Const CST_ORIENT_MEME As Long = 0            ' catCstOrientSame
Private Const CST_ORIENT_OPPOSE As Long = 1          ' catCstOrientOpposite
Private Const CST_STATUT_OK As Long = 0              ' catCstStatusOK
Private Const WORKMODE_CONCEPTION As Long = 2        ' DESIGN_MODE


'------------------------------------------------------------------------------
'  VARIABLES DE SESSION
'------------------------------------------------------------------------------
' Options (initialisées avec les constantes, modifiées par la fenêtre)
Public gOptTable As String
Public gOptMode As String
Public gOptOrientation As String
Public gOptRotation180 As Boolean
Public gOptIgnorer As Boolean

' Document
Private gDoc As Object
Private gRoot As Object
Private gSPA As Object
Private gRootPN As String
Private gRootNom As String
Private gFormatRef As Long
Private gSessionOK As Boolean

' Disjoncteur
Public gDisjChemin As String
Public gDisjPN As String
Public gNbFaces As Long
Public gFaces() As Long
Private gPubsDisj As Object        ' Dictionary : publications NEMA existantes
Private gCacheDisj As Object       ' Dictionary : publication -> mesure (le disjoncteur ne bouge pas)

' Raccord modèle
Public gRacChemin As String
Public gRacPN As String
Public gNbAxesRac As Long
Public gAxesRac() As Long
Private gRacRef As Object

' Contrainte Fixe ajoutée par la macro ("" si aucune)
Private gFixeAjoutee As String

' Raccord courant (pour Face suivante et Axes suivants)
Public gCourantChemin As String
Public gCourantFace As Long
Public gCourantTable As String

' Journal et messages
Private gFso As Object
Private gJournal As Object
Public gCheminJournal As String
Public gMessages As String
Private gNbErreurs As Long

' Recherche des appariements de trous (indices 1 à 20)
Private mPatR(1 To 20) As Variant
Private mPatH(1 To 20) As Variant
Private mNumH(1 To 20) As Long
Private mAffect(1 To 20) As Long
Private mUtilise(1 To 20) As Boolean
Private mNbR As Long
Private mNbH As Long
Private mNR As Variant
Private mNH As Variant
Private mListe() As String
Private mNbListe As Long
Private mSensVoulu As Long


'==============================================================================
'  POINT D'ENTRÉE
'==============================================================================
Public Sub CATMain()
    frmPlacementNEMA.Show
End Sub


'==============================================================================
'  SESSION
'==============================================================================
' Ouvre le journal, vérifie le document actif et détecte le disjoncteur et le
' raccord. Appelée à l'ouverture de la fenêtre.
Public Function InitialiserSession() As Boolean
    Dim tn As String, nomDoc As String

    InitialiserSession = False
    gSessionOK = False
    gMessages = ""
    gNbErreurs = 0
    gFormatRef = 0
    gFixeAjoutee = ""
    gDisjChemin = ""
    gRacChemin = ""
    gCourantChemin = ""
    gCourantFace = 0
    gCourantTable = ""
    gNbFaces = 0
    gNbAxesRac = 0
    ReDim gFaces(0)
    ReDim gAxesRac(0)
    gOptTable = TABLE_AXES
    gOptMode = MODE_CONTRAINTES
    gOptOrientation = ORIENTATION_FACE
    gOptRotation180 = ROTATION_180
    gOptIgnorer = IGNORER_FACES_DEJA_EQUIPEES

    OuvrirJournal
    Journal "PLACEMENT DES RACCORDS NEMA v" & VERSION_OUTIL & " - " & DateHeureLisible()
    Journal "Journal : " & gCheminJournal

    On Error Resume Next
    Err.Clear
    Set gDoc = CATIA.ActiveDocument
    If Err.Number <> 0 Then
        Message "!! Aucun document actif : ouvrez le CATProduct puis relancez."
        Exit Function
    End If
    tn = TypeName(gDoc)
    nomDoc = gDoc.Name
    If tn <> "ProductDocument" And LCase(Right(nomDoc, 11)) <> ".catproduct" Then
        Message "!! Le document actif doit être un CATProduct (document actif : " & nomDoc & ")."
        Exit Function
    End If
    Err.Clear
    Set gRoot = gDoc.Product
    If Err.Number <> 0 Then
        Message "!! Produit racine illisible : " & Err.Description
        Exit Function
    End If
    gRootPN = gRoot.PartNumber
    gRootNom = gRoot.Name
    Journal "Document : " & nomDoc & " ; produit racine : PartNumber """ & gRootPN & """, Name """ & gRootNom & """"

    If PASSER_EN_MODE_CONCEPTION Then
        Err.Clear
        gRoot.ApplyWorkMode WORKMODE_CONCEPTION
        If Err.Number <> 0 Then
            Journal "   ApplyWorkMode DESIGN_MODE : erreur " & Err.Number & " - " & Err.Description
        Else
            Journal "   Mode Conception appliqué (pièces chargées, aucun fichier modifié)."
        End If
    End If

    Err.Clear
    Set gSPA = gDoc.GetWorkbench("SPAWorkbench")
    If Err.Number <> 0 Then
        Message "!! Atelier de mesure (SPAWorkbench) indisponible : " & Err.Description
        Exit Function
    End If
    On Error GoTo 0

    Set gPubsDisj = CreateObject("Scripting.Dictionary")
    Set gCacheDisj = CreateObject("Scripting.Dictionary")
    gSessionOK = True
    DetecterAutomatiquement
    InitialiserSession = True
End Function

' Appelée à la fermeture de la fenêtre.
Public Sub FinSession()
    If Not gSessionOK And gJournal Is Nothing Then Exit Sub
    If gSessionOK Then ProposerSuppressionFixe True
    gSessionOK = False
    Journal "FIN DE SESSION - " & DateHeureLisible() & " - erreurs journalisées : " & gNbErreurs
    On Error Resume Next
    gJournal.Close
    Set gJournal = Nothing
    Err.Clear
End Sub

Private Function PretPourPlacement() As Boolean
    PretPourPlacement = False
    If Not gSessionOK Then
        Message "!! Session non initialisée (voir les messages ci-dessus)."
        Exit Function
    End If
    If gDisjChemin = "" Or gNbFaces = 0 Then
        Message "!! Choisissez d'abord le disjoncteur (bouton Analyser disjoncteur)."
        Exit Function
    End If
    If gRacChemin = "" Or gNbAxesRac = 0 Then
        Message "!! Choisissez d'abord le raccord modèle (bouton Analyser raccord)."
        Exit Function
    End If
    PretPourPlacement = True
End Function


'==============================================================================
'  DÉTECTION DU DISJONCTEUR ET DU RACCORD
'==============================================================================
Public Sub DetecterAutomatiquement()
    Dim chemins() As String, nb As Long, i As Long, p As Object, pn As String, memePN As Boolean

    ' Disjoncteur : l'instance qui publie "Face NEMA 1"
    nb = TrouverInstanceParPublication(PUB_FACE_DISJ & "1", "", chemins)
    If nb = 1 Then
        DefinirDisjoncteur chemins(1)
    ElseIf nb = 0 Then
        Message "Aucune instance ne publie """ & PUB_FACE_DISJ & "1"" : cliquez sur Analyser disjoncteur."
    Else
        Message nb & " instances publient """ & PUB_FACE_DISJ & "1"" : cliquez sur Analyser disjoncteur pour choisir."
    End If

    ' Raccord : l'instance qui publie "Face NEMA.1" et "Point CABLE.1"
    nb = TrouverInstanceParPublication(PUB_FACE_RAC, PUB_CABLE_RAC, chemins)
    If nb = 0 Then
        Message "Aucune instance ne publie """ & PUB_FACE_RAC & """ et """ & PUB_CABLE_RAC & """ : cliquez sur Analyser raccord."
        Exit Sub
    End If
    ' Plusieurs instances de la même référence ne sont pas ambiguës.
    memePN = True
    pn = ""
    For i = 1 To nb
        Set p = ProduitDepuisChemin(chemins(i))
        If Not p Is Nothing Then
            If pn = "" Then
                pn = LirePartNumber(p)
            ElseIf LirePartNumber(p) <> pn Then
                memePN = False
            End If
        End If
    Next
    If memePN Then
        DefinirRaccord chemins(1)
    Else
        Message "Plusieurs références de raccord trouvées : cliquez sur Analyser raccord pour choisir."
    End If
End Sub

' Cherche les instances qui portent la publication nomPub1 (et nomPub2 si non
' vide). Remplit chemins(1..nb) et renvoie nb. On ne descend pas sous une
' instance reconnue.
Public Function TrouverInstanceParPublication(ByVal nomPub1 As String, ByVal nomPub2 As String, chemins() As String) As Long
    Dim nb As Long
    nb = 0
    ReDim chemins(0)
    ParcourirPourPublication gRoot, "", 1, nomPub1, nomPub2, chemins, nb
    TrouverInstanceParPublication = nb
End Function

Private Sub ParcourirPourPublication(ByVal prod As Object, ByVal chemin As String, ByVal niveau As Long, ByVal nomPub1 As String, ByVal nomPub2 As String, chemins() As String, nb As Long)
    Dim enfants As Object, n As Long, i As Long, enfant As Object, c As String, nomEnfant As String, ok As Boolean

    On Error Resume Next
    Err.Clear
    Set enfants = prod.Products
    If Err.Number <> 0 Then Exit Sub
    n = 0
    n = enfants.Count
    For i = 1 To n
        Set enfant = Nothing
        Set enfant = enfants.Item(i)
        If Not enfant Is Nothing Then
            nomEnfant = "?"
            nomEnfant = enfant.Name
            If chemin = "" Then
                c = nomEnfant
            Else
                c = chemin & "/" & nomEnfant
            End If
            ok = APublication(enfant, nomPub1)
            If ok And nomPub2 <> "" Then ok = APublication(enfant, nomPub2)
            If ok Then
                nb = nb + 1
                ReDim Preserve chemins(nb)
                chemins(nb) = c
            ElseIf niveau < PROFONDEUR_MAX Then
                ParcourirPourPublication enfant, c, niveau + 1, nomPub1, nomPub2, chemins, nb
            End If
        End If
    Next
    Err.Clear
End Sub

' Vrai si le produit (ou son produit de référence) porte la publication.
Public Function APublication(ByVal prod As Object, ByVal nomPub As String) As Boolean
    Dim pub As Object
    APublication = False
    On Error Resume Next
    Err.Clear
    Set pub = Nothing
    Set pub = prod.ReferenceProduct.Publications.Item(nomPub)
    If Err.Number = 0 And Not pub Is Nothing Then
        APublication = True
        Exit Function
    End If
    Err.Clear
    Set pub = Nothing
    Set pub = prod.Publications.Item(nomPub)
    If Err.Number = 0 And Not pub Is Nothing Then APublication = True
    Err.Clear
End Function

Public Function DefinirDisjoncteur(ByVal chemin As String) As Boolean
    Dim p As Object, n As Long, j As Long, nomPub As String

    DefinirDisjoncteur = False
    Set p = ProduitDepuisChemin(chemin)
    If p Is Nothing Then
        Message "!! Instance introuvable : " & chemin
        Exit Function
    End If
    gDisjChemin = chemin
    gDisjPN = LirePartNumber(p)
    gNbFaces = 0
    ReDim gFaces(0)
    Set gPubsDisj = CreateObject("Scripting.Dictionary")
    Set gCacheDisj = CreateObject("Scripting.Dictionary")
    For n = 1 To INDICE_MAX
        If APublication(p, PUB_FACE_DISJ & n) Then
            gNbFaces = gNbFaces + 1
            ReDim Preserve gFaces(gNbFaces)
            gFaces(gNbFaces) = n
            gPubsDisj.Item(PUB_FACE_DISJ & n) = True
            For j = 1 To INDICE_MAX
                nomPub = PUB_AXE_DISJ & n & "." & j
                If APublication(p, nomPub) Then gPubsDisj.Item(nomPub) = True
            Next
        End If
    Next
    Message "Disjoncteur : " & gDisjPN & " (" & chemin & ") - " & gNbFaces & " face(s) NEMA."
    DefinirDisjoncteur = (gNbFaces > 0)
End Function

Public Function DefinirRaccord(ByVal chemin As String) As Boolean
    Dim p As Object, k As Long

    DefinirRaccord = False
    Set p = ProduitDepuisChemin(chemin)
    If p Is Nothing Then
        Message "!! Instance introuvable : " & chemin
        Exit Function
    End If
    If Not APublication(p, PUB_FACE_RAC) Then
        Message "!! " & chemin & " ne publie pas """ & PUB_FACE_RAC & """."
        Exit Function
    End If
    On Error Resume Next
    Set gRacRef = Nothing
    Set gRacRef = p.ReferenceProduct
    On Error GoTo 0
    If gRacRef Is Nothing Then
        Message "!! Produit de référence du raccord illisible."
        Exit Function
    End If
    gRacChemin = chemin
    gRacPN = LirePartNumber(p)
    gNbAxesRac = 0
    ReDim gAxesRac(0)
    For k = 1 To INDICE_MAX
        If APublication(p, PUB_AXE_RAC & k) Then
            gNbAxesRac = gNbAxesRac + 1
            ReDim Preserve gAxesRac(gNbAxesRac)
            gAxesRac(gNbAxesRac) = k
        End If
    Next
    Message "Raccord modèle : " & gRacPN & " (" & chemin & ") - " & gNbAxesRac & " axe(s) -> " & (gNbAxesRac + 1) & " contrainte(s) par raccord en mode COMPLET."
    DefinirRaccord = (gNbAxesRac > 0)
End Function

' Sélection interactive (la fenêtre doit être cachée avant l'appel).
Public Function ChoisirDisjoncteurParSelection() As Boolean
    Dim c As String
    ChoisirDisjoncteurParSelection = False
    If Not gSessionOK Then Exit Function
    c = SelectionnerProduit("Sélectionnez le DISJONCTEUR (arbre ou vue 3D)", PUB_FACE_DISJ & "1")
    If c <> "" Then ChoisirDisjoncteurParSelection = DefinirDisjoncteur(c)
End Function

Public Function ChoisirRaccordParSelection() As Boolean
    Dim c As String
    ChoisirRaccordParSelection = False
    If Not gSessionOK Then Exit Function
    c = SelectionnerProduit("Sélectionnez le RACCORD modèle (arbre ou vue 3D)", PUB_FACE_RAC)
    If c <> "" Then ChoisirRaccordParSelection = DefinirRaccord(c)
End Function

' Sélection d'un raccord déjà posé, pour Face suivante / Axes suivants.
Public Function ChoisirRaccordACorriger() As Boolean
    Dim c As String, n As Long, t As String
    ChoisirRaccordACorriger = False
    If Not PretPourPlacement() Then Exit Function
    c = SelectionnerProduit("Sélectionnez le RACCORD à corriger (arbre ou vue 3D)", PUB_FACE_RAC)
    If c = "" Then Exit Function
    If DeduirePose(c, n, t) Then
        DefinirPoseCourante c, n, t
        Message "Raccord courant : " & c & " sur " & PUB_FACE_DISJ & n & "."
        ChoisirRaccordACorriger = True
    Else
        Message "!! " & c & " n'est posé sur aucune plage (ses axes ne tombent pas sur des trous)."
    End If
End Function

' SelectElement2 avec le filtre "Product", puis remontée jusqu'au produit qui
' porte la publication demandée. Renvoie le chemin de l'instance ou "".
Private Function SelectionnerProduit(ByVal invite As String, ByVal pubRequise As String) As String
    Dim sel As Variant, filtre(0) As Variant, etat As String, p As Object, k As Long

    SelectionnerProduit = ""
    On Error Resume Next
    Err.Clear
    ' Selection et filtre en Variant : nécessaire en VBA pour SelectElement2.
    Set sel = gDoc.Selection
    sel.Clear
    filtre(0) = "Product"
    etat = sel.SelectElement2(filtre, invite, False)
    If Err.Number <> 0 Then
        Message "!! Sélection impossible : " & Err.Description
        Exit Function
    End If
    If etat <> "Normal" Then
        Message "Sélection annulée."
        Exit Function
    End If
    Set p = Nothing
    Set p = sel.Item(1).Value
    sel.Clear
    For k = 1 To 20
        If p Is Nothing Then Exit For
        If APublication(p, pubRequise) Then
            SelectionnerProduit = CheminDepuisRacine(p)
            Exit Function
        End If
        If TypeName(p.Parent) <> "Products" Then Exit For
        Set p = p.Parent.Parent
    Next
    Message "!! L'élément choisi ne publie pas """ & pubRequise & """."
End Function

' Instance depuis son chemin "Inst.1/SousInst.1" (relatif au produit racine).
Public Function ProduitDepuisChemin(ByVal chemin As String) As Object
    Dim p As Object, morceaux As Variant, i As Long
    Set ProduitDepuisChemin = Nothing
    If chemin = "" Then Exit Function
    On Error Resume Next
    Set p = gRoot
    morceaux = Split(chemin, "/")
    For i = LBound(morceaux) To UBound(morceaux)
        Err.Clear
        Set p = p.Products.Item(CStr(morceaux(i)))
        If Err.Number <> 0 Then Exit Function
    Next
    Set ProduitDepuisChemin = p
End Function

' Chemin d'une instance depuis le produit racine (remonte les Parent).
Public Function CheminDepuisRacine(ByVal prod As Object) As String
    Dim p As Object, col As Object, c As String, k As Long, nom As String
    c = ""
    On Error Resume Next
    Set p = prod
    For k = 1 To 20
        Set col = Nothing
        Set col = p.Parent
        If col Is Nothing Then Exit For
        If TypeName(col) <> "Products" Then Exit For
        nom = p.Name
        If c = "" Then
            c = nom
        Else
            c = nom & "/" & c
        End If
        Set p = col.Parent
    Next
    Err.Clear
    CheminDepuisRacine = c
End Function

Private Function LirePartNumber(ByVal p As Object) As String
    LirePartNumber = "?"
    On Error Resume Next
    LirePartNumber = p.PartNumber
    Err.Clear
End Function

' Dernier segment d'un chemin : "A.1/B.1" -> "B.1"
Private Function NomInstance(ByVal chemin As String) As String
    Dim p As Long
    p = InStrRev(chemin, "/")
    If p > 0 Then
        NomInstance = Mid(chemin, p + 1)
    Else
        NomInstance = chemin
    End If
End Function


'==============================================================================
'  REFERENCES ET MESURES
'==============================================================================
' Crée la Reference d'une publication dans le contexte du produit racine.
' Formats essayés (le premier qui marche est retenu pour la suite) :
'   F1 = PartNumber racine / chemin instance /!publication   (format des macros enregistrées)
'   F2 = Name racine / chemin instance /!publication
'   F3 = chemin instance /!publication
' Une Reference est jugée valide si GetMeasurable réussit dessus.
Public Function CreerRefPublication(ByVal chemin As String, ByVal nomPub As String) As Object
    Dim ordre(1 To 3) As Long, n As Long, f As Long, i As Long, etiquette As String, ref As Object, m As Variant, msg As String

    Set CreerRefPublication = Nothing
    n = 0
    If gFormatRef > 0 Then
        n = n + 1
        ordre(n) = gFormatRef
    End If
    For f = 1 To 3
        If f <> gFormatRef Then
            n = n + 1
            ordre(n) = f
        End If
    Next

    On Error Resume Next
    For i = 1 To n
        etiquette = LibelleReference(ordre(i), chemin, nomPub)
        If etiquette <> "" Then
            Err.Clear
            Set ref = Nothing
            Set ref = gRoot.CreateReferenceFromName(etiquette)
            If Err.Number <> 0 Or ref Is Nothing Then
                msg = "CreateReferenceFromName : " & Err.Description
            Else
                Err.Clear
                Set m = Nothing
                Set m = gSPA.GetMeasurable(ref)
                If Err.Number = 0 Then
                    If gFormatRef <> ordre(i) Then Journal "   Format de Reference retenu : F" & ordre(i)
                    gFormatRef = ordre(i)
                    Journal "   Reference : " & etiquette
                    Set CreerRefPublication = ref
                    Exit Function
                End If
                msg = "GetMeasurable : " & Err.Description
            End If
            Journal "   (échec F" & ordre(i) & ") " & etiquette & " : " & msg
        End If
    Next
    Err.Clear
    Message "!! Reference impossible pour """ & nomPub & """ de " & chemin & " (détail dans le journal)."
End Function

Private Function LibelleReference(ByVal f As Long, ByVal chemin As String, ByVal nomPub As String) As String
    LibelleReference = ""
    Select Case f
        Case 1
            LibelleReference = gRootPN & "/" & chemin & "/!" & nomPub
        Case 2
            If gRootNom <> gRootPN Then LibelleReference = gRootNom & "/" & chemin & "/!" & nomPub
        Case 3
            LibelleReference = chemin & "/!" & nomPub
    End Select
End Function

' Mesure une publication (repère du produit racine, mm). Renvoie Empty ou :
'   rec(0) = "PLAN" / "AXE" / "POINT"
'   rec(1) = point (origine du plan, point de l'axe, ou point)
'   rec(2) = normale unitaire (plan) ou direction unitaire (axe), Empty sinon
'   rec(3) = 1re direction du plan, Empty sinon
Public Function MesurerPublication(ByVal chemin As String, ByVal nomPub As String) As Variant
    Dim ref As Object, m As Variant, t As Variant, P As Variant, D As Variant, U As Variant, V As Variant

    MesurerPublication = Empty
    Set ref = CreerRefPublication(chemin, nomPub)
    If ref Is Nothing Then Exit Function
    On Error Resume Next
    Err.Clear
    ' Measurable en Variant (non typé) : nécessaire en VBA pour passer les tableaux.
    Set m = gSPA.GetMeasurable(ref)
    If Err.Number <> 0 Then
        JournalErreur "GetMeasurable " & nomPub, Err.Number, Err.Description
        Exit Function
    End If
    On Error GoTo 0

    ' Plan (faces et plans)
    If Left(nomPub, 4) = "Face" Or Left(nomPub, 4) = "Plan" Then
        t = EssayerGetPlane(m)
        If IsArray(t) Then
            P = V3(t(0), t(1), t(2))
            U = Unitaire(V3(t(3), t(4), t(5)))
            V = V3(t(6), t(7), t(8))
            If IsArray(U) Then
                D = Unitaire(Vectoriel(U, V))
                If IsArray(D) Then
                    MesurerPublication = Enreg("PLAN", P, D, U)
                    Exit Function
                End If
            End If
        End If
    End If

    ' Axe : cylindre (GetAxis + GetPointsOnAxis) ou droite (GetDirection + GetPointsOnCurve)
    P = Empty
    D = Empty
    t = EssayerGetAxis(m)
    If IsArray(t) Then D = Unitaire(V3(t(0), t(1), t(2)))
    t = EssayerGetPointsOnAxis(m)
    If IsArray(t) Then
        P = V3(t(0), t(1), t(2))
        If Not IsArray(D) Then D = Unitaire(V3(t(6) - t(3), t(7) - t(4), t(8) - t(5)))
    End If
    If Not (IsArray(P) And IsArray(D)) Then
        t = EssayerGetDirection(m)
        If IsArray(t) And Not IsArray(D) Then D = Unitaire(V3(t(0), t(1), t(2)))
        t = EssayerGetPointsOnCurve(m)
        If IsArray(t) Then
            If Not IsArray(P) Then P = V3(t(3), t(4), t(5))
            If Not IsArray(D) Then D = Unitaire(V3(t(6) - t(0), t(7) - t(1), t(8) - t(2)))
        End If
    End If
    If Not IsArray(P) Then
        t = EssayerGetCenter(m)
        If IsArray(t) Then P = V3(t(0), t(1), t(2))
    End If
    If Not IsArray(P) Then
        t = EssayerGetPoint(m)
        If IsArray(t) Then P = V3(t(0), t(1), t(2))
    End If

    If IsArray(P) And IsArray(D) Then
        MesurerPublication = Enreg("AXE", P, D, Empty)
    ElseIf IsArray(P) Then
        MesurerPublication = Enreg("POINT", P, Empty, Empty)
    Else
        Message "!! " & nomPub & " (" & chemin & ") : géométrie non interprétée."
    End If
End Function

' Mesure d'une publication du disjoncteur (mise en cache : il ne bouge pas).
Private Function MesureDisj(ByVal nomPub As String) As Variant
    Dim r As Variant
    If gCacheDisj.Exists(nomPub) Then
        r = gCacheDisj.Item(nomPub)
    Else
        r = MesurerPublication(gDisjChemin, nomPub)
        If IsArray(r) Then gCacheDisj.Item(nomPub) = r
    End If
    MesureDisj = r
End Function

Private Function Mesure(ByVal chemin As String, ByVal nomPub As String) As Variant
    If chemin = gDisjChemin Then
        Mesure = MesureDisj(nomPub)
    Else
        Mesure = MesurerPublication(chemin, nomPub)
    End If
End Function

' Plan d'une face : origine O, normale N, 1re direction U.
Public Function LirePlan(ByVal chemin As String, ByVal nomPub As String, O As Variant, N As Variant, U As Variant) As Boolean
    Dim rec As Variant
    LirePlan = False
    rec = Mesure(chemin, nomPub)
    If Not IsArray(rec) Then Exit Function
    If rec(0) <> "PLAN" Then
        Message "!! " & nomPub & " (" & chemin & ") n'est pas plane (" & rec(0) & ")."
        Exit Function
    End If
    O = rec(1)
    N = rec(2)
    U = rec(3)
    LirePlan = True
End Function

' Axe d'un trou : point P et direction D (D = Empty si seul un point est connu).
Public Function LireAxe(ByVal chemin As String, ByVal nomPub As String, P As Variant, D As Variant) As Boolean
    Dim rec As Variant
    LireAxe = False
    rec = Mesure(chemin, nomPub)
    If Not IsArray(rec) Then Exit Function
    If rec(0) = "PLAN" Then
        Message "!! " & nomPub & " (" & chemin & ") est un plan, pas un axe."
        Exit Function
    End If
    P = rec(1)
    D = rec(2)
    LireAxe = True
End Function

' Points des axes nums(1..nb) projetés sur la face (et normale de la face).
Private Function PointsMotif(ByVal chemin As String, ByVal nomFace As String, ByVal prefixe As String, nums As Variant, ByVal nb As Long, pts As Variant, N As Variant) As Boolean
    Dim O As Variant, U As Variant, P As Variant, D As Variant, i As Long, t() As Variant

    PointsMotif = False
    If nb < 1 Then Exit Function
    If Not LirePlan(chemin, nomFace, O, N, U) Then Exit Function
    ReDim t(1 To nb)
    For i = 1 To nb
        If Not LireAxe(chemin, prefixe & nums(i), P, D) Then Exit Function
        t(i) = ProjeterSurPlan(P, D, O, N)
    Next
    pts = t
    PointsMotif = True
End Function

' Chaque fonction appelle UNE méthode du Measurable avec un tableau Variant et
' renvoie le tableau, ou Empty si la méthode échoue. Appel SANS parenthèses
' pour que le tableau soit passé par référence et rempli.
Private Function EssayerGetPlane(m As Variant) As Variant
    Dim t(8) As Variant
    EssayerGetPlane = Empty
    On Error Resume Next
    Err.Clear
    m.GetPlane t
    If Err.Number = 0 Then EssayerGetPlane = t
    Err.Clear
End Function

Private Function EssayerGetAxis(m As Variant) As Variant
    Dim t(2) As Variant
    EssayerGetAxis = Empty
    On Error Resume Next
    Err.Clear
    m.GetAxis t
    If Err.Number = 0 Then EssayerGetAxis = t
    Err.Clear
End Function

Private Function EssayerGetPointsOnAxis(m As Variant) As Variant
    Dim t(8) As Variant
    EssayerGetPointsOnAxis = Empty
    On Error Resume Next
    Err.Clear
    m.GetPointsOnAxis t
    If Err.Number = 0 Then EssayerGetPointsOnAxis = t
    Err.Clear
End Function

Private Function EssayerGetDirection(m As Variant) As Variant
    Dim t(2) As Variant
    EssayerGetDirection = Empty
    On Error Resume Next
    Err.Clear
    m.GetDirection t
    If Err.Number = 0 Then EssayerGetDirection = t
    Err.Clear
End Function

Private Function EssayerGetPointsOnCurve(m As Variant) As Variant
    Dim t(8) As Variant
    EssayerGetPointsOnCurve = Empty
    On Error Resume Next
    Err.Clear
    m.GetPointsOnCurve t
    If Err.Number = 0 Then EssayerGetPointsOnCurve = t
    Err.Clear
End Function

Private Function EssayerGetCenter(m As Variant) As Variant
    Dim t(2) As Variant
    EssayerGetCenter = Empty
    On Error Resume Next
    Err.Clear
    m.GetCenter t
    If Err.Number = 0 Then EssayerGetCenter = t
    Err.Clear
End Function

Private Function EssayerGetPoint(m As Variant) As Variant
    Dim t(2) As Variant
    EssayerGetPoint = Empty
    On Error Resume Next
    Err.Clear
    m.GetPoint t
    If Err.Number = 0 Then EssayerGetPoint = t
    Err.Clear
End Function

Private Function Enreg(ByVal typ As String, P As Variant, D As Variant, U As Variant) As Variant
    Dim r(3) As Variant
    r(0) = typ
    r(1) = P
    r(2) = D
    r(3) = U
    Enreg = r
End Function


'==============================================================================
'  PRÉPOSITIONNEMENT
'==============================================================================
' Calcule la matrice (12 valeurs, format Move.Apply : 3 colonnes de rotation
' puis la translation) qui amène les points ptsR du raccord sur les points ptsD
' de la plage. Avec 3 trous non alignés ou plus, la pose est entièrement fixée
' par les trous (le côté du raccord découle de la table des axes). Avec 2 trous,
' les normales des faces décident du côté.
Public Function CalculerMatrice(ptsR As Variant, NR As Variant, ptsD As Variant, ND As Variant, ByVal nb As Long) As Variant
    Dim a As Long, b As Long, c As Long, ia As Long, ib As Long, ic As Long, best As Double, aire As Double
    Dim xr As Variant, yr As Variant, zr As Variant, xd As Variant, yd As Variant, zd As Variant
    Dim cr As Variant, cd As Variant, e As Variant, tr As Variant, i As Long, res(11) As Variant

    CalculerMatrice = Empty
    best = 0
    ia = 0
    For a = 1 To nb - 2
        For b = a + 1 To nb - 1
            For c = b + 1 To nb
                aire = Norme(Vectoriel(Soustraire(ptsR(b), ptsR(a)), Soustraire(ptsR(c), ptsR(a))))
                If aire > best Then
                    best = aire
                    ia = a
                    ib = b
                    ic = c
                End If
            Next
        Next
    Next

    If ia > 0 And best > 1 Then
        ' Repères construits sur le plus grand triangle de trous
        xr = Unitaire(Soustraire(ptsR(ib), ptsR(ia)))
        zr = Unitaire(Vectoriel(xr, Soustraire(ptsR(ic), ptsR(ia))))
        xd = Unitaire(Soustraire(ptsD(ib), ptsD(ia)))
        zd = Unitaire(Vectoriel(xd, Soustraire(ptsD(ic), ptsD(ia))))
    Else
        ' 1 ou 2 trous : les faces se font face (normales opposées), sauf
        ' orientation "MEME" demandée.
        zr = NR
        If gOptOrientation = "MEME" Then
            zd = ND
        Else
            zd = Echelle(ND, -1)
        End If
        If nb >= 2 Then
            xr = Unitaire(OrthoPlan(Soustraire(ptsR(2), ptsR(1)), zr))
            xd = Unitaire(OrthoPlan(Soustraire(ptsD(2), ptsD(1)), zd))
        Else
            xr = DirectionPerpendiculaire(zr)
            xd = DirectionPerpendiculaire(zd)
            Message "!! Raccord à un seul axe : rotation autour de l'axe non garantie."
        End If
    End If
    If Not (IsArray(xr) And IsArray(zr) And IsArray(xd) And IsArray(zd)) Then
        Message "!! Matrice de placement impossible (trous confondus ?)."
        Exit Function
    End If
    yr = Vectoriel(zr, xr)
    yd = Vectoriel(zd, xd)

    cr = Centre(ptsR, nb)
    cd = Centre(ptsD, nb)
    ' Colonne i de R : R.e_i = xd * xr(i) + yd * yr(i) + zd * zr(i)
    For i = 0 To 2
        e = Ajouter(Ajouter(Echelle(xd, xr(i)), Echelle(yd, yr(i))), Echelle(zd, zr(i)))
        res(3 * i) = e(0)
        res(3 * i + 1) = e(1)
        res(3 * i + 2) = e(2)
    Next
    ' Translation : t = cd - R.cr
    tr = Soustraire(cd, Tourner(res, cr))
    res(9) = tr(0)
    res(10) = tr(1)
    res(11) = tr(2)
    CalculerMatrice = res
End Function

' Amène le raccord sur la plage n avant de créer les contraintes.
' Les mesures sont dans le repère du produit racine et le raccord est un enfant
' direct du produit racine : la matrice calculée est donc directement le
' déplacement à appliquer. Repli : position absolue = matrice o position
' actuelle (Position.GetComponents / SetComponents).
Public Function Prepositionner(ByVal chemin As String, ByVal n As Long, ByVal table As String) As Boolean
    Dim js As Variant, nb As Long, ptsR As Variant, NR As Variant, ptsD As Variant, ND As Variant
    Dim T As Variant, prod As Object, avant As Variant, ecart As Double

    Prepositionner = False
    nb = ParserListe(table, js)
    If nb <> gNbAxesRac Then Exit Function
    If Not PointsMotif(gDisjChemin, PUB_FACE_DISJ & n, PUB_AXE_DISJ & n & ".", js, nb, ptsD, ND) Then Exit Function
    If Not PointsMotif(chemin, PUB_FACE_RAC, PUB_AXE_RAC, TableauAxesRac(), nb, ptsR, NR) Then Exit Function
    T = CalculerMatrice(ptsR, NR, ptsD, ND, nb)
    If Not IsArray(T) Then Exit Function
    Set prod = ProduitDepuisChemin(chemin)
    If prod Is Nothing Then Exit Function
    avant = LirePosition(prod)

    ' 1) Move.Apply (déplacement relatif)
    ecart = -1
    If AppliquerMove(prod, T) Then
        ecart = EcartPose(chemin, n, table)
        If ecart >= 0 And ecart <= TOLERANCE_MM Then
            Journal "   prépositionné par Move.Apply (écart " & FmtN(ecart) & " mm)"
            Prepositionner = True
            Exit Function
        End If
        Journal "   écart après Move.Apply : " & FmtN(ecart) & " mm -> essai par Position.SetComponents"
    End If

    ' 2) Repli : position absolue calculée depuis la position initiale
    If IsArray(avant) Then
        If EcrirePosition(prod, Composer(T, avant)) Then
            ecart = EcartPose(chemin, n, table)
            If ecart >= 0 And ecart <= TOLERANCE_MM Then
                Journal "   prépositionné par Position.SetComponents (écart " & FmtN(ecart) & " mm)"
                Prepositionner = True
                Exit Function
            End If
        End If
    End If
    Message "   (prépositionnement imprécis : écart " & FmtN(ecart) & " mm ; les contraintes finiront le placement)"
    Prepositionner = True
End Function

Private Function AppliquerMove(ByVal prod As Object, T As Variant) As Boolean
    Dim mv As Variant, arr(11) As Variant, i As Long
    AppliquerMove = False
    For i = 0 To 11
        arr(i) = T(i)
    Next
    On Error Resume Next
    Err.Clear
    Set mv = prod.Move
    mv.Apply arr
    If Err.Number <> 0 Then
        JournalErreur "Move.Apply", Err.Number, Err.Description
        Exit Function
    End If
    AppliquerMove = True
End Function

Private Function LirePosition(ByVal prod As Object) As Variant
    Dim pos As Variant, c(11) As Variant
    LirePosition = Empty
    On Error Resume Next
    Err.Clear
    Set pos = prod.Position
    pos.GetComponents c
    If Err.Number <> 0 Then
        JournalErreur "Position.GetComponents", Err.Number, Err.Description
        Exit Function
    End If
    LirePosition = c
End Function

Private Function EcrirePosition(ByVal prod As Object, comps As Variant) As Boolean
    Dim pos As Variant, c(11) As Variant, i As Long
    EcrirePosition = False
    For i = 0 To 11
        c(i) = comps(i)
    Next
    On Error Resume Next
    Err.Clear
    Set pos = prod.Position
    pos.SetComponents c
    If Err.Number <> 0 Then
        JournalErreur "Position.SetComponents", Err.Number, Err.Description
        Exit Function
    End If
    EcrirePosition = True
End Function

' Écart maximal (mm) entre les axes du raccord et les trous visés, et entre les
' plans des faces. -1 si une mesure échoue.
Private Function EcartPose(ByVal chemin As String, ByVal n As Long, ByVal table As String) As Double
    Dim js As Variant, nb As Long, i As Long, PR As Variant, DR As Variant, PH As Variant, DH As Variant
    Dim ecart As Double, maxi As Double, ORac As Variant, NRac As Variant, URac As Variant, ODis As Variant, NDis As Variant, UDis As Variant

    EcartPose = -1
    nb = ParserListe(table, js)
    If nb <> gNbAxesRac Then Exit Function
    maxi = 0
    For i = 1 To nb
        If Not LireAxe(chemin, PUB_AXE_RAC & gAxesRac(i), PR, DR) Then Exit Function
        If Not LireAxe(gDisjChemin, PUB_AXE_DISJ & n & "." & js(i), PH, DH) Then Exit Function
        ecart = DistanceAxes(PR, DR, PH, DH)
        If ecart < 0 Then ecart = 999
        If ecart > maxi Then maxi = ecart
    Next
    If Not LirePlan(chemin, PUB_FACE_RAC, ORac, NRac, URac) Then Exit Function
    If Not LirePlan(gDisjChemin, PUB_FACE_DISJ & n, ODis, NDis, UDis) Then Exit Function
    ecart = Abs(Scalaire(Soustraire(ORac, ODis), NDis))
    If ecart > maxi Then maxi = ecart
    EcartPose = maxi
End Function


'==============================================================================
'  CONTRAINTES
'==============================================================================
Public Function AjouterCoincidence(ByVal refA As Object, ByVal refB As Object, ByVal libelle As String) As Object
    Dim csts As Object, cst As Object, nom As String

    Set AjouterCoincidence = Nothing
    On Error Resume Next
    Err.Clear
    Set csts = gRoot.Connections("CATIAConstraints")
    Set cst = csts.AddBiEltCst(CST_TYPE_COINCIDENCE, refA, refB)
    If Err.Number <> 0 Or cst Is Nothing Then
        JournalErreur "AddBiEltCst (" & libelle & ")", Err.Number, Err.Description
        Exit Function
    End If
    nom = cst.Name
    Journal "   + " & nom & " : " & libelle
    Set AjouterCoincidence = cst
End Function

' Vrai si une contrainte cite déjà la face n (ou un de ses trous) du disjoncteur.
Public Function FaceDejaEquipee(ByVal n As Long) As Boolean
    Dim csts As Object, i As Long, e As Long, dn As String, chemin As String, elem As String, nb As Long
    Dim ref As Object, dnFace As String

    FaceDejaEquipee = False
    ' DisplayName exact de la Reference de la face : comparaison indépendante
    ' du format des noms dans les contraintes.
    dnFace = ""
    Set ref = CreerRefPublication(gDisjChemin, PUB_FACE_DISJ & n)
    On Error Resume Next
    If Not ref Is Nothing Then dnFace = ref.DisplayName
    Err.Clear
    Set csts = gRoot.Connections("CATIAConstraints")
    nb = 0
    nb = csts.Count
    For i = 1 To nb
        For e = 1 To 2
            dn = ""
            dn = csts.Item(i).GetConstraintElement(e).DisplayName
            Err.Clear
            If dn <> "" And dn = dnFace Then
                FaceDejaEquipee = True
                Exit Function
            End If
            If dn <> "" Then
                DecouperDisplayName dn, chemin, elem
                If CheminCorrespond(chemin, gDisjChemin) Then
                    If elem = PUB_FACE_DISJ & n Or Left(elem, Len(PUB_AXE_DISJ & n & ".")) = PUB_AXE_DISJ & n & "." Then
                        FaceDejaEquipee = True
                        Exit Function
                    End If
                End If
            End If
        Next
    Next
    Err.Clear
End Function

' Vrai si une contrainte cite l'instance.
Private Function InstanceUtilisee(ByVal chemin As String) As Boolean
    Dim csts As Object, i As Long, e As Long, dn As String, nb As Long

    InstanceUtilisee = False
    On Error Resume Next
    Set csts = gRoot.Connections("CATIAConstraints")
    nb = 0
    nb = csts.Count
    For i = 1 To nb
        For e = 1 To 2
            dn = ""
            dn = csts.Item(i).GetConstraintElement(e).DisplayName
            Err.Clear
            If ElementDeLInstance(dn, chemin) Then
                InstanceUtilisee = True
                Exit Function
            End If
        Next
    Next
    Err.Clear
End Function

' Supprime les contraintes entre le raccord et le disjoncteur. Renvoie le nombre.
Private Function SupprimerContraintesRaccord(ByVal chemin As String) As Long
    Dim csts As Object, i As Long, dn1 As String, dn2 As String, nom As String, nb As Long, total As Long

    SupprimerContraintesRaccord = 0
    On Error Resume Next
    Set csts = gRoot.Connections("CATIAConstraints")
    total = 0
    total = csts.Count
    nb = 0
    For i = total To 1 Step -1
        dn1 = ""
        dn2 = ""
        dn1 = csts.Item(i).GetConstraintElement(1).DisplayName
        dn2 = csts.Item(i).GetConstraintElement(2).DisplayName
        Err.Clear
        If (ElementDeLInstance(dn1, chemin) And ElementDeLInstance(dn2, gDisjChemin)) Or _
           (ElementDeLInstance(dn2, chemin) And ElementDeLInstance(dn1, gDisjChemin)) Then
            nom = csts.Item(i).Name
            csts.Remove i
            If Err.Number <> 0 Then
                JournalErreur "suppression de " & nom, Err.Number, Err.Description
            Else
                Journal "   - " & nom & " supprimée"
                nb = nb + 1
            End If
        End If
    Next
    Err.Clear
    If nb = 0 Then Message "   (aucune contrainte trouvée entre " & chemin & " et le disjoncteur)"
    SupprimerContraintesRaccord = nb
End Function

' Ajoute une contrainte Fixe sur le disjoncteur s'il n'est pas déjà fixé.
Private Sub AssurerFixe()
    Dim csts As Object, cst As Object, ref As Object, f As Long, etiquette As String, dn As String, nom As String

    If gFixeAjoutee <> "" Then Exit Sub
    If DisjoncteurDejaFixe() Then
        Journal "Disjoncteur déjà fixé : pas de contrainte Fixe ajoutée."
        Exit Sub
    End If
    On Error Resume Next
    Set csts = gRoot.Connections("CATIAConstraints")
    For f = 1 To 3
        etiquette = LibelleFixe(f)
        If etiquette <> "" Then
            Err.Clear
            Set ref = Nothing
            Set ref = gRoot.CreateReferenceFromName(etiquette)
            If Err.Number = 0 And Not ref Is Nothing Then
                Set cst = Nothing
                Set cst = csts.AddMonoEltCst(CST_TYPE_FIXE, ref)
                If Err.Number = 0 And Not cst Is Nothing Then
                    dn = ""
                    dn = cst.GetConstraintElement(1).DisplayName
                    nom = cst.Name
                    If Err.Number = 0 And dn <> "" Then
                        gFixeAjoutee = nom
                        Message "Contrainte « " & nom & " » ajoutée sur le disjoncteur (protection pendant le placement)."
                        Journal "   Reference Fixe : " & etiquette & " -> " & dn
                        Exit Sub
                    End If
                    ' Élément illisible : on retire la contrainte et on essaie le format suivant.
                    Err.Clear
                    csts.Remove nom
                End If
            End If
            Journal "   (échec Fixe) " & etiquette & " : " & Err.Description
        End If
    Next
    Err.Clear
    Message "!! Contrainte Fixe impossible sur le disjoncteur : le placement continue sans protection."
End Sub

' Formats de Reference pour fixer une instance entière.
' F1 est le format des macros enregistrées (« Racine/Inst.1/!Racine/Inst.1/ »).
' A CONFIRMER : F2 et F3 sont des replis.
Private Function LibelleFixe(ByVal f As Long) As String
    Select Case f
        Case 1
            LibelleFixe = gRootPN & "/" & gDisjChemin & "/!" & gRootPN & "/" & gDisjChemin & "/"
        Case 2
            LibelleFixe = gRootPN & "/" & gDisjChemin & "/!" & gDisjChemin & "/"
        Case Else
            LibelleFixe = gDisjChemin & "/!" & gDisjChemin & "/"
    End Select
End Function

Private Function DisjoncteurDejaFixe() As Boolean
    Dim csts As Object, i As Long, nb As Long, t As Long, dn As String

    DisjoncteurDejaFixe = False
    On Error Resume Next
    Set csts = gRoot.Connections("CATIAConstraints")
    nb = 0
    nb = csts.Count
    For i = 1 To nb
        t = -1
        t = csts.Item(i).Type
        If t = CST_TYPE_FIXE Then
            dn = ""
            dn = csts.Item(i).GetConstraintElement(1).DisplayName
            If ElementDeLInstance(dn, gDisjChemin) Then
                DisjoncteurDejaFixe = True
                Exit Function
            End If
        End If
        Err.Clear
    Next
    Err.Clear
End Function

' Question posée quand tous les raccords sont placés, et à la fermeture.
Public Sub ProposerSuppressionFixe(ByVal fermeture As Boolean)
    Dim msg As String, rep As Long, csts As Object

    If gFixeAjoutee = "" Then Exit Sub
    msg = "La macro a ajouté la contrainte « " & gFixeAjoutee & " » sur le disjoncteur, par protection pendant le placement." & vbCrLf & vbCrLf
    If fermeture Then
        msg = msg & "Voulez-vous la supprimer maintenant ?"
    Else
        msg = msg & "Tous les raccords sont placés. Voulez-vous la supprimer maintenant ?" & vbCrLf & vbCrLf & _
              "Non : elle reste en place pour les corrections (Face suivante, Axes suivants). La question sera reposée à la fermeture de la fenêtre."
    End If
    rep = MsgBox(msg, vbYesNo + vbQuestion, "Contrainte Fixe du disjoncteur")
    If rep <> vbYes Then
        Journal "Contrainte " & gFixeAjoutee & " conservée à la demande de l'utilisateur."
        Exit Sub
    End If
    On Error Resume Next
    Err.Clear
    Set csts = gRoot.Connections("CATIAConstraints")
    csts.Remove gFixeAjoutee
    If Err.Number <> 0 Then
        JournalErreur "suppression de " & gFixeAjoutee, Err.Number, Err.Description
        Message "!! Suppression de « " & gFixeAjoutee & " » impossible : supprimez-la à la main."
    Else
        Message "Contrainte « " & gFixeAjoutee & " » supprimée."
        gFixeAjoutee = ""
    End If
    Err.Clear
End Sub

Private Function OrientationVoulue(ByVal chemin As String, ByVal n As Long) As Long
    Dim ORac As Variant, NRac As Variant, URac As Variant, ODis As Variant, NDis As Variant, UDis As Variant

    Select Case gOptOrientation
        Case "OPPOSE"
            OrientationVoulue = CST_ORIENT_OPPOSE
        Case "MEME"
            OrientationVoulue = CST_ORIENT_MEME
        Case Else
            ' AUTO : d'après les normales mesurées après le prépositionnement
            OrientationVoulue = -1
            If LirePlan(chemin, PUB_FACE_RAC, ORac, NRac, URac) And LirePlan(gDisjChemin, PUB_FACE_DISJ & n, ODis, NDis, UDis) Then
                If Scalaire(NRac, NDis) < 0 Then
                    OrientationVoulue = CST_ORIENT_OPPOSE
                Else
                    OrientationVoulue = CST_ORIENT_MEME
                End If
            End If
    End Select
End Function

Private Sub RegleOrientation(ByVal cst As Object, ByVal o As Long)
    On Error Resume Next
    Err.Clear
    cst.Orientation = o
    If Err.Number <> 0 Then
        JournalErreur "Orientation de " & cst.Name, Err.Number, Err.Description
    Else
        Journal "   orientation de " & cst.Name & " : " & NomOrientation(o)
    End If
    Err.Clear
End Sub

Private Sub InverserOrientation(ByVal cst As Object)
    Dim o As Long
    o = -1
    On Error Resume Next
    o = cst.Orientation
    Err.Clear
    On Error GoTo 0
    If o = CST_ORIENT_MEME Then
        RegleOrientation cst, CST_ORIENT_OPPOSE
    Else
        RegleOrientation cst, CST_ORIENT_MEME
    End If
End Sub

Private Function NomOrientation(ByVal o As Long) As String
    If o = CST_ORIENT_MEME Then
        NomOrientation = "même sens"
    ElseIf o = CST_ORIENT_OPPOSE Then
        NomOrientation = "sens opposé"
    Else
        NomOrientation = "indéfinie"
    End If
End Function

Private Sub MettreAJour()
    On Error Resume Next
    Err.Clear
    gRoot.Update
    If Err.Number <> 0 Then JournalErreur "rootProduct.Update", Err.Number, Err.Description
    Err.Clear
End Sub

' Nombre de contraintes (parmi "nom1|nom2|...") dont le statut n'est pas OK.
Private Function ContraintesEnErreur(ByVal noms As String) As Long
    Dim t As Variant, i As Long, csts As Object, s As Long, nb As Long

    ContraintesEnErreur = 0
    If noms = "" Then Exit Function
    On Error Resume Next
    Set csts = gRoot.Connections("CATIAConstraints")
    t = Split(noms, "|")
    nb = 0
    For i = LBound(t) To UBound(t)
        If t(i) <> "" Then
            s = -1
            s = csts.Item(CStr(t(i))).Status
            Err.Clear
            If s <> CST_STATUT_OK Then
                nb = nb + 1
                Journal "   !! " & t(i) & " : statut " & s & " (0 = OK)"
            End If
        End If
    Next
    ContraintesEnErreur = nb
End Function


'==============================================================================
'  PLACEMENT
'==============================================================================
' Bouton « Création » : un raccord sur chaque Face NEMA libre du disjoncteur.
Public Sub CreerTousLesRaccords()
    Dim table As String, libres() As String, nbLibres As Long, iLibre As Long, f As Long, n As Long
    Dim chemin As String, noms As String, tousNoms As String, nouvelle As Boolean
    Dim nbPoses As Long, nbCst As Long, nbErr As Long, nbIgnorees As Long, nbEchecs As Long

    If Not PretPourPlacement() Then Exit Sub
    table = TableEffective()
    If table = "" Then Exit Sub
    Journal ""
    Journal "=== CRÉATION - " & DateHeureLisible() & " ==="
    Journal "Options : mode " & gOptMode & ", orientation " & gOptOrientation & ", table " & table & ", ignorer faces équipées " & gOptIgnorer
    AssurerFixe

    nbLibres = InstancesLibres(libres)
    Journal "Instances libres du raccord " & gRacPN & " : " & nbLibres
    iLibre = 0
    tousNoms = ""
    For f = 1 To gNbFaces
        n = gFaces(f)
        If gOptIgnorer And FaceDejaEquipee(n) Then
            Journal PUB_FACE_DISJ & n & " : déjà équipée, ignorée."
            nbIgnorees = nbIgnorees + 1
        Else
            nouvelle = False
            If iLibre < nbLibres Then
                iLibre = iLibre + 1
                chemin = libres(iLibre)
                Journal PUB_FACE_DISJ & n & " : instance existante réutilisée " & chemin
            Else
                chemin = NouvelleInstance()
                nouvelle = True
            End If
            If chemin = "" Then
                nbEchecs = nbEchecs + 1
            ElseIf PoserRaccord(chemin, n, table, noms) Then
                nbPoses = nbPoses + 1
                nbCst = nbCst + NombreElements(noms)
                tousNoms = tousNoms & "|" & noms
                DefinirPoseCourante chemin, n, table
            Else
                nbEchecs = nbEchecs + 1
                If nouvelle Then SupprimerInstance chemin
            End If
        End If
    Next

    MettreAJour
    nbErr = ContraintesEnErreur(tousNoms)
    Message "Création : " & nbPoses & " raccord(s) posé(s), " & nbCst & " contrainte(s) créée(s), " & nbErr & " en erreur" & _
            ", " & nbIgnorees & " face(s) déjà équipée(s), " & nbEchecs & " échec(s)."
    If nbErr > 0 Then Message "   Contraintes en erreur : voir le journal. Si c'est une surcontrainte, essayez le mode « Face + axes de l'exemple »."
    If gFixeAjoutee <> "" And ToutesFacesEquipees() Then ProposerSuppressionFixe False
End Sub

' Pose un raccord sur la face n : prépositionnement, contraintes, mise à jour,
' contrôle. nomsCst reçoit les noms des contraintes créées ("nom1|nom2|...").
Public Function PoserRaccord(ByVal chemin As String, ByVal n As Long, ByVal table As String, nomsCst As String) As Boolean
    Dim js As Variant, nb As Long, i As Long, k As Long, refR As Object, refD As Object
    Dim cstFace As Object, cst As Object, o As Long, e1 As Double, e2 As Double

    PoserRaccord = False
    nomsCst = ""
    nb = ParserListe(table, js)
    If nb <> gNbAxesRac Then Exit Function
    Journal ">> " & chemin & " sur " & PUB_FACE_DISJ & n & " (axes " & DescriptionTable(table) & ")"

    ' 1. Les trous visés existent-ils ?
    For i = 1 To nb
        If Not gPubsDisj.Exists(PUB_AXE_DISJ & n & "." & js(i)) Then
            Message "!! " & PUB_FACE_DISJ & n & " : le trou """ & PUB_AXE_DISJ & n & "." & js(i) & """ n'existe pas. Face ignorée."
            Exit Function
        End If
    Next

    ' 2. Prépositionnement
    If PREPOSITIONNER Then
        If Not Prepositionner(chemin, n, table) Then
            Message "!! " & PUB_FACE_DISJ & n & " : prépositionnement impossible (mesures). Face ignorée."
            Exit Function
        End If
    End If

    ' 3. Coïncidence des faces
    Set refR = CreerRefPublication(chemin, PUB_FACE_RAC)
    Set refD = CreerRefPublication(gDisjChemin, PUB_FACE_DISJ & n)
    If refR Is Nothing Or refD Is Nothing Then Exit Function
    Set cstFace = AjouterCoincidence(refR, refD, chemin & " " & PUB_FACE_RAC & " <-> " & PUB_FACE_DISJ & n)
    If cstFace Is Nothing Then Exit Function
    nomsCst = cstFace.Name
    o = OrientationVoulue(chemin, n)
    If o >= 0 Then RegleOrientation cstFace, o

    ' 4. Coïncidences des axes
    For i = 1 To nb
        k = gAxesRac(i)
        If AxeAContraindre(k) Then
            Set refR = CreerRefPublication(chemin, PUB_AXE_RAC & k)
            Set refD = CreerRefPublication(gDisjChemin, PUB_AXE_DISJ & n & "." & js(i))
            If Not (refR Is Nothing Or refD Is Nothing) Then
                Set cst = AjouterCoincidence(refR, refD, chemin & " " & PUB_AXE_RAC & k & " <-> " & PUB_AXE_DISJ & n & "." & js(i))
                If Not cst Is Nothing Then nomsCst = nomsCst & "|" & cst.Name
            End If
        End If
    Next

    ' 5. Mise à jour et contrôle. En AUTO, si le raccord s'est retourné, on
    '    inverse l'orientation de la face ; on garde la meilleure des deux.
    MettreAJour
    e1 = EcartPose(chemin, n, table)
    If e1 > TOLERANCE_MM And gOptOrientation = "AUTO" Then
        Journal "   écart " & FmtN(e1) & " mm après mise à jour : essai avec l'orientation inverse"
        InverserOrientation cstFace
        MettreAJour
        e2 = EcartPose(chemin, n, table)
        If e2 < 0 Or e2 > e1 Then
            InverserOrientation cstFace
            MettreAJour
        Else
            e1 = e2
        End If
    End If
    If e1 >= 0 And e1 <= TOLERANCE_MM Then
        Journal "   position contrôlée : écart maximal " & FmtN(e1) & " mm"
    ElseIf e1 < 0 Then
        Message "   (" & chemin & " : contrôle de position impossible, mesure en échec)"
    Else
        Message "!! " & chemin & " sur " & PUB_FACE_DISJ & n & " : écart " & FmtN(e1) & " mm après mise à jour. À vérifier."
    End If
    PoserRaccord = True
End Function

' Bouton « Face suivante » : déplace le raccord courant sur la prochaine face
' libre. Si toutes les faces sont équipées, le raccord de la face suivante
' devient le raccord courant (pour le corriger avec « Axes suivants »).
Public Sub FaceSuivante()
    Dim idx As Long, f As Long, essai As Long, n2 As Long, noms As String, chemin As String, t As String, nn As Long

    If Not PretPourPlacement() Then Exit Sub
    If gCourantChemin = "" Then
        Message "Aucun raccord courant."
        Exit Sub
    End If
    idx = IndiceFace(gCourantFace)
    n2 = 0
    For essai = 1 To gNbFaces
        f = ((idx - 1 + essai) Mod gNbFaces) + 1
        If f <> idx Then
            If Not FaceDejaEquipee(gFaces(f)) Then
                n2 = gFaces(f)
                Exit For
            End If
        End If
    Next

    If n2 = 0 Then
        f = (idx Mod gNbFaces) + 1
        chemin = RaccordSurFace(gFaces(f), nn, t)
        If chemin <> "" Then
            DefinirPoseCourante chemin, gFaces(f), t
            Message "Toutes les faces sont équipées. Raccord courant : " & chemin & " (" & PUB_FACE_DISJ & gFaces(f) & ") ; Axes suivants permet de le corriger."
        Else
            Message "Toutes les faces sont équipées ; raccord de la " & PUB_FACE_DISJ & gFaces(f) & " introuvable."
        End If
        Exit Sub
    End If

    Journal ""
    Journal "=== FACE SUIVANTE : " & gCourantChemin & " de " & PUB_FACE_DISJ & gCourantFace & " vers " & PUB_FACE_DISJ & n2 & " ==="
    AssurerFixe
    SupprimerContraintesRaccord gCourantChemin
    If PoserRaccord(gCourantChemin, n2, gCourantTable, noms) Then
        DefinirPoseCourante gCourantChemin, n2, gCourantTable
        Message gCourantChemin & " déplacé sur " & PUB_FACE_DISJ & n2 & " : " & NombreElements(noms) & " contrainte(s), " & ContraintesEnErreur(noms) & " en erreur."
    Else
        Message "!! Déplacement de " & gCourantChemin & " vers " & PUB_FACE_DISJ & n2 & " impossible (voir le journal)."
    End If
End Sub

' Bouton « Axes suivants » : repose le raccord courant sur la même face avec
' l'appariement de trous suivant (même côté de la plage, sans retournement).
Public Sub AxesSuivants()
    Dim liste As Variant, nb As Long, i As Long, idx As Long, suivante As String, noms As String

    If Not PretPourPlacement() Then Exit Sub
    If gCourantChemin = "" Then
        Message "Aucun raccord courant."
        Exit Sub
    End If
    nb = ListerAppariements(gCourantChemin, gCourantFace, gCourantTable, liste)
    If nb <= 1 Then
        Message "Aucune autre correspondance d'axes possible sur " & PUB_FACE_DISJ & gCourantFace & "."
        Exit Sub
    End If
    idx = 0
    For i = 1 To nb
        If liste(i) = gCourantTable Then idx = i
    Next
    suivante = liste((idx Mod nb) + 1)

    Journal ""
    Journal "=== AXES SUIVANTS : " & gCourantChemin & " sur " & PUB_FACE_DISJ & gCourantFace & " : " & gCourantTable & " -> " & suivante & " ==="
    AssurerFixe
    SupprimerContraintesRaccord gCourantChemin
    If PoserRaccord(gCourantChemin, gCourantFace, suivante, noms) Then
        DefinirPoseCourante gCourantChemin, gCourantFace, suivante
        Message gCourantChemin & " : axes " & DescriptionTable(suivante) & " (" & ((idx Mod nb) + 1) & "/" & nb & "), " & ContraintesEnErreur(noms) & " contrainte(s) en erreur."
    Else
        Message "!! Échec de la nouvelle pose de " & gCourantChemin & " (voir le journal)."
    End If
End Sub

Public Sub DefinirPoseCourante(ByVal chemin As String, ByVal n As Long, ByVal table As String)
    gCourantChemin = chemin
    gCourantFace = n
    gCourantTable = table
End Sub

Public Function DescriptionPoseCourante() As String
    If gCourantChemin = "" Then
        DescriptionPoseCourante = "Raccord courant : aucun"
    Else
        DescriptionPoseCourante = "Raccord courant : " & gCourantChemin & " sur " & PUB_FACE_DISJ & gCourantFace & " - axes " & DescriptionTable(gCourantTable)
    End If
End Function

' Instances du raccord, enfants directs du produit racine, citées par aucune
' contrainte. Elles sont réutilisées avant d'en créer de nouvelles.
Private Function InstancesLibres(libres() As String) As Long
    Dim enfants As Object, i As Long, n As Long, p As Object, nb As Long, nom As String

    nb = 0
    ReDim libres(0)
    On Error Resume Next
    Set enfants = gRoot.Products
    n = enfants.Count
    For i = 1 To n
        Set p = Nothing
        Set p = enfants.Item(i)
        If Not p Is Nothing Then
            If LirePartNumber(p) = gRacPN Then
                nom = p.Name
                If Not InstanceUtilisee(nom) Then
                    nb = nb + 1
                    ReDim Preserve libres(nb)
                    libres(nb) = nom
                End If
            End If
        End If
    Next
    Err.Clear
    InstancesLibres = nb
End Function

' Nouvelle instance de la référence du raccord (pièce de catalogue) sous le
' produit racine. Seul le nom d'instance est fixé ; le PartNumber ne change pas.
Private Function NouvelleInstance() As String
    Dim p As Object, nom As String, pn As String, nomAuto As String

    NouvelleInstance = ""
    nom = NomInstanceLibre(gRacPN)
    On Error Resume Next
    Err.Clear
    Set p = gRoot.Products.AddComponent(gRacRef)
    If Err.Number <> 0 Or p Is Nothing Then
        JournalErreur "Products.AddComponent", Err.Number, Err.Description
        Message "!! Impossible de créer une instance de " & gRacPN & "."
        Exit Function
    End If
    pn = p.PartNumber
    nomAuto = p.Name
    If nomAuto <> nom Then
        Err.Clear
        p.Name = nom
        If Err.Number <> 0 Then
            JournalErreur "nom d'instance " & nom, Err.Number, Err.Description
            nom = nomAuto
        End If
    End If
    Err.Clear
    If pn <> gRacPN Then Message "!! PartNumber inattendu pour la nouvelle instance : " & pn
    Journal "   Nouvelle instance : " & nom & " (PartNumber " & pn & ", inchangé)"
    NouvelleInstance = nom
End Function

Private Function NomInstanceLibre(ByVal pn As String) As String
    Dim i As Long, enfants As Object, k As Long, n As Long, pris As Boolean, nom As String

    NomInstanceLibre = pn & ".1"
    On Error Resume Next
    Set enfants = gRoot.Products
    n = enfants.Count
    For i = 1 To 999
        pris = False
        For k = 1 To n
            nom = ""
            nom = enfants.Item(k).Name
            If nom = pn & "." & i Then
                pris = True
                Exit For
            End If
        Next
        If Not pris Then
            NomInstanceLibre = pn & "." & i
            Exit Function
        End If
    Next
    Err.Clear
End Function

Private Sub SupprimerInstance(ByVal nom As String)
    On Error Resume Next
    Err.Clear
    gRoot.Products.Remove nom
    If Err.Number <> 0 Then
        JournalErreur "retrait de l'instance non posée " & nom, Err.Number, Err.Description
    Else
        Journal "   Instance non posée retirée : " & nom
    End If
    Err.Clear
End Sub

Private Function ToutesFacesEquipees() As Boolean
    Dim f As Long
    ToutesFacesEquipees = False
    For f = 1 To gNbFaces
        If Not FaceDejaEquipee(gFaces(f)) Then Exit Function
    Next
    ToutesFacesEquipees = True
End Function

Private Function IndiceFace(ByVal n As Long) As Long
    Dim f As Long
    IndiceFace = 0
    For f = 1 To gNbFaces
        If gFaces(f) = n Then IndiceFace = f
    Next
End Function

Private Function AxeAContraindre(ByVal k As Long) As Boolean
    If gOptMode = "EXEMPLE" Then
        AxeAContraindre = (InStr("," & Replace(AXES_MODE_EXEMPLE, " ", "") & ",", "," & k & ",") > 0)
    Else
        AxeAContraindre = True
    End If
End Function

' Raccord (enfant du produit racine) posé sur la face n, d'après la géométrie.
Private Function RaccordSurFace(ByVal n As Long, nTrouve As Long, table As String) As String
    Dim enfants As Object, i As Long, nbE As Long, p As Object, nom As String

    RaccordSurFace = ""
    On Error Resume Next
    Set enfants = gRoot.Products
    nbE = enfants.Count
    For i = 1 To nbE
        Set p = Nothing
        Set p = enfants.Item(i)
        If Not p Is Nothing Then
            If LirePartNumber(p) = gRacPN Then
                nom = p.Name
                If DeduirePose(nom, nTrouve, table) Then
                    If nTrouve = n Then
                        RaccordSurFace = nom
                        Exit Function
                    End If
                End If
            End If
        End If
    Next
    Err.Clear
End Function

' Face et table d'un raccord déjà posé, déduites de la géométrie : chaque axe
' du raccord doit coïncider avec un trou de la même face.
Public Function DeduirePose(ByVal chemin As String, n As Long, table As String) As Boolean
    Dim i As Long, f As Long, j As Long, P As Variant, D As Variant, PH As Variant, DH As Variant
    Dim dist As Double, best As Double, bN As Long, bJ As Long, t As String

    DeduirePose = False
    n = 0
    table = ""
    t = ""
    For i = 1 To gNbAxesRac
        If Not LireAxe(chemin, PUB_AXE_RAC & gAxesRac(i), P, D) Then Exit Function
        best = 1E+30
        bN = 0
        bJ = 0
        For f = 1 To gNbFaces
            For j = 1 To INDICE_MAX
                If gPubsDisj.Exists(PUB_AXE_DISJ & gFaces(f) & "." & j) Then
                    If LireAxe(gDisjChemin, PUB_AXE_DISJ & gFaces(f) & "." & j, PH, DH) Then
                        dist = DistanceAxes(P, D, PH, DH)
                        If dist >= 0 And dist < best Then
                            best = dist
                            bN = gFaces(f)
                            bJ = j
                        End If
                    End If
                End If
            Next
        Next
        If bN = 0 Or best > TOLERANCE_MOTIF_MM Then Exit Function
        If n = 0 Then n = bN
        If bN <> n Then Exit Function
        If i > 1 Then t = t & ","
        t = t & bJ
    Next
    table = t
    DeduirePose = (n > 0)
End Function


'==============================================================================
'  TABLE DES AXES ET APPARIEMENTS
'==============================================================================
' Table utilisée : celle de la fenêtre (ou correspondance directe si vide),
' inversée si « Rotation 180° » est cochée. "" si la table est invalide.
Public Function TableEffective() As String
    Dim t As String, vals As Variant, nb As Long, i As Long, r As String, k As Long

    TableEffective = ""
    t = Replace(Replace(Trim(gOptTable), " ", ""), ";", ",")
    If t = "" Then
        For i = 1 To gNbAxesRac
            If i > 1 Then t = t & ","
            t = t & gAxesRac(i)
        Next
    End If
    nb = ParserListe(t, vals)
    If nb <> gNbAxesRac Then
        Message "!! Table des axes """ & t & """ invalide : il faut " & gNbAxesRac & " numéro(s) de trou différents, séparés par des virgules (un par axe du raccord)."
        Exit Function
    End If
    For i = 1 To nb
        For k = i + 1 To nb
            If vals(i) = vals(k) Then
                Message "!! Table des axes """ & t & """ : le trou " & vals(i) & " est utilisé deux fois."
                Exit Function
            End If
        Next
    Next
    r = ""
    For i = 1 To nb
        If i > 1 Then r = r & ","
        If gOptRotation180 Then
            r = r & vals(nb + 1 - i)
        Else
            r = r & vals(i)
        End If
    Next
    TableEffective = r
End Function

' "1,2,3,4" -> vals(1..4) ; renvoie le nombre de valeurs, -1 si invalide.
Private Function ParserListe(ByVal s As String, vals As Variant) As Long
    Dim morceaux As Variant, i As Long, t() As Long, n As Long

    ParserListe = 0
    s = Trim(s)
    If s = "" Then Exit Function
    morceaux = Split(s, ",")
    n = UBound(morceaux) - LBound(morceaux) + 1
    ReDim t(1 To n)
    For i = 1 To n
        If Not EstEntier(Trim(CStr(morceaux(LBound(morceaux) + i - 1)))) Then
            ParserListe = -1
            Exit Function
        End If
        t(i) = CLng(Trim(CStr(morceaux(LBound(morceaux) + i - 1))))
        If t(i) < 1 Then
            ParserListe = -1
            Exit Function
        End If
    Next
    vals = t
    ParserListe = n
End Function

' "1,2,3,4" -> "1->1 2->2 3->3 4->4" (axe du raccord -> trou de la plage)
Public Function DescriptionTable(ByVal table As String) As String
    Dim vals As Variant, nb As Long, i As Long, r As String
    nb = ParserListe(table, vals)
    r = ""
    For i = 1 To nb
        If i <= gNbAxesRac Then r = r & gAxesRac(i) & "->" & vals(i) & " "
    Next
    DescriptionTable = Trim(r)
End Function

Private Function TableauAxesRac() As Variant
    Dim t() As Long, i As Long
    ReDim t(1 To gNbAxesRac)
    For i = 1 To gNbAxesRac
        t(i) = gAxesRac(i)
    Next
    TableauAxesRac = t
End Function

' Toutes les tables possibles du raccord sur la face n (entraxes respectés),
' du même côté de la plage que tableRef. Renvoie le nombre ; liste(1..nb).
Private Function ListerAppariements(ByVal chemin As String, ByVal n As Long, ByVal tableRef As String, liste As Variant) As Long
    Dim ptsR As Variant, NR As Variant, nums() As Long, nbH As Long, ptsH As Variant, NH As Variant
    Dim i As Long, j As Long, js As Variant, complet As Boolean

    ListerAppariements = 0
    nbH = 0
    ReDim nums(1 To 20)
    For j = 1 To INDICE_MAX
        If gPubsDisj.Exists(PUB_AXE_DISJ & n & "." & j) And nbH < 20 Then
            nbH = nbH + 1
            nums(nbH) = j
        End If
    Next
    If gNbAxesRac > 20 Or nbH < gNbAxesRac Then Exit Function
    If Not PointsMotif(chemin, PUB_FACE_RAC, PUB_AXE_RAC, TableauAxesRac(), gNbAxesRac, ptsR, NR) Then Exit Function
    If Not PointsMotif(gDisjChemin, PUB_FACE_DISJ & n, PUB_AXE_DISJ & n & ".", nums, nbH, ptsH, NH) Then Exit Function

    mNbR = gNbAxesRac
    mNbH = nbH
    For i = 1 To mNbR
        mPatR(i) = ptsR(i)
    Next
    For i = 1 To mNbH
        mPatH(i) = ptsH(i)
        mNumH(i) = nums(i)
        mUtilise(i) = False
    Next
    mNR = NR
    mNH = NH

    ' Côté de la table de référence (pour ne pas proposer de raccord retourné)
    mSensVoulu = 0
    If ParserListe(tableRef, js) = mNbR Then
        complet = True
        For i = 1 To mNbR
            mAffect(i) = 0
            For j = 1 To mNbH
                If mNumH(j) = js(i) Then mAffect(i) = j
            Next
            If mAffect(i) = 0 Then complet = False
        Next
        If complet Then mSensVoulu = SensAffectation()
    End If

    mNbListe = 0
    ReDim mListe(0)
    For i = 1 To 20
        mAffect(i) = 0
    Next
    ChercherAppariements 1
    liste = mListe
    ListerAppariements = mNbListe
End Function

Private Sub ChercherAppariements(ByVal k As Long)
    Dim j As Long, m As Long, ok As Boolean, s As Long, t As String

    If k > mNbR Then
        s = SensAffectation()
        If mSensVoulu = 0 Or s = 0 Or s = mSensVoulu Then
            t = ""
            For m = 1 To mNbR
                If m > 1 Then t = t & ","
                t = t & mNumH(mAffect(m))
            Next
            mNbListe = mNbListe + 1
            ReDim Preserve mListe(mNbListe)
            mListe(mNbListe) = t
        End If
        Exit Sub
    End If
    For j = 1 To mNbH
        If Not mUtilise(j) Then
            ok = True
            For m = 1 To k - 1
                If Abs(Distance3(mPatR(k), mPatR(m)) - Distance3(mPatH(j), mPatH(mAffect(m)))) > TOLERANCE_MOTIF_MM Then
                    ok = False
                    Exit For
                End If
            Next
            If ok Then
                mUtilise(j) = True
                mAffect(k) = j
                ChercherAppariements k + 1
                mUtilise(j) = False
                mAffect(k) = 0
            End If
        End If
    Next
End Sub

' +1 / -1 selon que l'appariement mAffect garde le raccord du même côté ou le
' retourne (par rapport aux normales mesurées) ; 0 si indéterminé.
Private Function SensAffectation() As Long
    Dim a As Long, b As Long, c As Long, ia As Long, ib As Long, ic As Long, best As Double, aire As Double, sR As Double, sH As Double

    SensAffectation = 0
    best = 0
    ia = 0
    For a = 1 To mNbR - 2
        For b = a + 1 To mNbR - 1
            For c = b + 1 To mNbR
                aire = Norme(Vectoriel(Soustraire(mPatR(b), mPatR(a)), Soustraire(mPatR(c), mPatR(a))))
                If aire > best Then
                    best = aire
                    ia = a
                    ib = b
                    ic = c
                End If
            Next
        Next
    Next
    If ia = 0 Or best <= 1 Then Exit Function
    sR = Scalaire(Vectoriel(Soustraire(mPatR(ib), mPatR(ia)), Soustraire(mPatR(ic), mPatR(ia))), mNR)
    sH = Scalaire(Vectoriel(Soustraire(mPatH(mAffect(ib)), mPatH(mAffect(ia))), Soustraire(mPatH(mAffect(ic)), mPatH(mAffect(ia)))), mNH)
    If sR * sH > 0 Then
        SensAffectation = 1
    Else
        SensAffectation = -1
    End If
End Function


'==============================================================================
'  OUTILS : NOMS DES RÉFÉRENCES DANS LES CONTRAINTES
'==============================================================================
' "Racine/Inst.1/!Face NEMA 1" -> chemin = "Racine/Inst.1", elem = "Face NEMA 1"
Private Sub DecouperDisplayName(ByVal dn As String, chemin As String, elem As String)
    Dim p As Long
    p = InStr(dn, "/!")
    If p > 0 Then
        chemin = Left(dn, p - 1)
        elem = Mid(dn, p + 2)
    Else
        chemin = ""
        elem = dn
    End If
End Sub

' Vrai si le chemin lu dans un DisplayName désigne l'instance "cheminInst"
' (avec ou sans le nom du produit racine devant).
Private Function CheminCorrespond(ByVal chemin As String, ByVal cheminInst As String) As Boolean
    CheminCorrespond = False
    If chemin = "" Or cheminInst = "" Then Exit Function
    If chemin = cheminInst Then
        CheminCorrespond = True
    ElseIf Right(chemin, Len(cheminInst) + 1) = "/" & cheminInst Then
        CheminCorrespond = True
    End If
End Function

' Vrai si l'élément de contrainte (DisplayName) appartient à l'instance.
Private Function ElementDeLInstance(ByVal dn As String, ByVal cheminInst As String) As Boolean
    Dim chemin As String, elem As String
    ElementDeLInstance = False
    If dn = "" Then Exit Function
    DecouperDisplayName dn, chemin, elem
    If chemin <> "" Then
        ElementDeLInstance = CheminCorrespond(chemin, cheminInst)
    Else
        ' Format inattendu : on cherche le nom d'instance comme segment.
        ElementDeLInstance = (InStr("/" & dn & "/", "/" & NomInstance(cheminInst) & "/") > 0)
    End If
End Function

Private Function NombreElements(ByVal noms As String) As Long
    Dim t As Variant, i As Long, nb As Long
    nb = 0
    If noms <> "" Then
        t = Split(noms, "|")
        For i = LBound(t) To UBound(t)
            If t(i) <> "" Then nb = nb + 1
        Next
    End If
    NombreElements = nb
End Function

Private Function EstEntier(ByVal s As String) As Boolean
    Dim i As Long, ch As String
    EstEntier = False
    If Len(s) = 0 Then Exit Function
    For i = 1 To Len(s)
        ch = Mid(s, i, 1)
        If ch < "0" Or ch > "9" Then Exit Function
    Next
    EstEntier = True
End Function


'==============================================================================
'  OUTILS : VECTEURS (tableaux de 3 réels)
'==============================================================================
Private Function V3(ByVal x As Double, ByVal y As Double, ByVal z As Double) As Variant
    Dim r(2) As Double
    r(0) = x
    r(1) = y
    r(2) = z
    V3 = r
End Function

Private Function Ajouter(a As Variant, b As Variant) As Variant
    Ajouter = V3(a(0) + b(0), a(1) + b(1), a(2) + b(2))
End Function

Private Function Soustraire(a As Variant, b As Variant) As Variant
    Soustraire = V3(a(0) - b(0), a(1) - b(1), a(2) - b(2))
End Function

Private Function Echelle(a As Variant, ByVal s As Double) As Variant
    Echelle = V3(a(0) * s, a(1) * s, a(2) * s)
End Function

Private Function Scalaire(a As Variant, b As Variant) As Double
    Scalaire = a(0) * b(0) + a(1) * b(1) + a(2) * b(2)
End Function

Private Function Vectoriel(a As Variant, b As Variant) As Variant
    Vectoriel = V3(a(1) * b(2) - a(2) * b(1), a(2) * b(0) - a(0) * b(2), a(0) * b(1) - a(1) * b(0))
End Function

Private Function Norme(a As Variant) As Double
    Norme = Sqr(Scalaire(a, a))
End Function

' Vecteur unitaire, ou Empty si le vecteur est nul.
Private Function Unitaire(a As Variant) As Variant
    Dim l As Double
    l = Norme(a)
    If l < 0.000000001 Then
        Unitaire = Empty
    Else
        Unitaire = Echelle(a, 1 / l)
    End If
End Function

Private Function Distance3(a As Variant, b As Variant) As Double
    Distance3 = Norme(Soustraire(a, b))
End Function

' Composante de v perpendiculaire à n (n unitaire).
Private Function OrthoPlan(v As Variant, n As Variant) As Variant
    OrthoPlan = Soustraire(v, Echelle(n, Scalaire(v, n)))
End Function

' Une direction unitaire perpendiculaire à n.
Private Function DirectionPerpendiculaire(n As Variant) As Variant
    Dim d As Variant
    d = Unitaire(OrthoPlan(V3(1, 0, 0), n))
    If Not IsArray(d) Then d = Unitaire(OrthoPlan(V3(0, 1, 0), n))
    DirectionPerpendiculaire = d
End Function

Private Function Centre(pts As Variant, ByVal nb As Long) As Variant
    Dim G As Variant, i As Long
    G = V3(0, 0, 0)
    For i = 1 To nb
        G = Ajouter(G, pts(i))
    Next
    Centre = Echelle(G, 1 / nb)
End Function

' Applique la rotation (9 premières valeurs de M, en colonnes) au vecteur v.
Private Function Tourner(M As Variant, v As Variant) As Variant
    Tourner = V3(M(0) * v(0) + M(3) * v(1) + M(6) * v(2), _
                 M(1) * v(0) + M(4) * v(1) + M(7) * v(2), _
                 M(2) * v(0) + M(5) * v(1) + M(8) * v(2))
End Function

' Position absolue après le déplacement T : axes tournés, origine R.o + t.
Private Function Composer(T As Variant, pos As Variant) As Variant
    Dim r(11) As Variant, i As Long, v As Variant
    For i = 0 To 3
        v = Tourner(T, V3(pos(3 * i), pos(3 * i + 1), pos(3 * i + 2)))
        If i = 3 Then v = Ajouter(v, V3(T(9), T(10), T(11)))
        r(3 * i) = v(0)
        r(3 * i + 1) = v(1)
        r(3 * i + 2) = v(2)
    Next
    Composer = r
End Function

' Projette un axe (le long de sa direction) ou un point (orthogonalement) sur
' le plan (O, N), N unitaire.
Private Function ProjeterSurPlan(P As Variant, D As Variant, O As Variant, N As Variant) As Variant
    Dim t As Double, dn As Double
    If IsArray(D) Then
        dn = Scalaire(D, N)
        If Abs(dn) > 0.1 Then
            t = Scalaire(Soustraire(O, P), N) / dn
            ProjeterSurPlan = Ajouter(P, Echelle(D, t))
            Exit Function
        End If
    End If
    t = Scalaire(Soustraire(P, O), N)
    ProjeterSurPlan = Soustraire(P, Echelle(N, t))
End Function

' Distance entre deux axes parallèles (ou point/axe, ou point/point).
' -1 si les deux axes ne sont pas parallèles (écart > 1°).
Private Function DistanceAxes(PA As Variant, DA As Variant, PB As Variant, DB As Variant) As Double
    If IsArray(DA) And IsArray(DB) Then
        If Norme(Vectoriel(DA, DB)) > 0.0175 Then
            DistanceAxes = -1
        Else
            DistanceAxes = Norme(Vectoriel(Soustraire(PA, PB), DB))
        End If
    ElseIf IsArray(DB) Then
        DistanceAxes = Norme(Vectoriel(Soustraire(PA, PB), DB))
    ElseIf IsArray(DA) Then
        DistanceAxes = Norme(Vectoriel(Soustraire(PB, PA), DA))
    Else
        DistanceAxes = Distance3(PA, PB)
    End If
End Function


'==============================================================================
'  OUTILS : JOURNAL, MESSAGES, FORMATAGE
'==============================================================================
Private Sub OuvrirJournal()
    Dim dossier As String, nom As String

    On Error Resume Next
    Set gJournal = Nothing
    Set gFso = CreateObject("Scripting.FileSystemObject")
    dossier = DossierBureau()
    nom = "Placer_Raccords_NEMA_" & Horodatage() & ".txt"
    gCheminJournal = gFso.BuildPath(dossier, nom)
    Err.Clear
    ' 3e argument True = fichier Unicode (accents conservés)
    Set gJournal = gFso.CreateTextFile(gCheminJournal, True, True)
    If Err.Number <> 0 Then
        Err.Clear
        gCheminJournal = gFso.BuildPath(Environ("TEMP"), nom)
        Set gJournal = gFso.CreateTextFile(gCheminJournal, True, True)
    End If
    If Err.Number <> 0 Then
        Set gJournal = Nothing
        gCheminJournal = "(journal impossible à créer)"
    End If
    Err.Clear
End Sub

Private Function DossierBureau() As String
    Dim d As String, sh As Object
    d = ""
    On Error Resume Next
    Set sh = CreateObject("WScript.Shell")
    d = sh.SpecialFolders("Desktop")
    If d = "" Or Not gFso.FolderExists(d) Then d = Environ("USERPROFILE") & "\Desktop"
    If Not gFso.FolderExists(d) Then d = Environ("TEMP")
    Err.Clear
    DossierBureau = d
End Function

' Ligne horodatée dans le journal.
Public Sub Journal(ByVal texte As String)
    On Error Resume Next
    If Not gJournal Is Nothing Then gJournal.WriteLine "[" & Format(Now, "hh:nn:ss") & "] " & texte
    Err.Clear
End Sub

' Message affiché dans la fenêtre (et écrit dans le journal).
Public Sub Message(ByVal texte As String)
    Journal texte
    gMessages = gMessages & texte & vbCrLf
    If Len(gMessages) > 20000 Then gMessages = Right(gMessages, 15000)
End Sub

' Passer Err.Number et Err.Description en arguments : ils sont lus avant l'appel.
Private Sub JournalErreur(ByVal contexte As String, ByVal numero As Long, ByVal description As String)
    gNbErreurs = gNbErreurs + 1
    Journal "   !! ERREUR (" & contexte & ") : n° " & numero & " - " & description
End Sub

' Réel avec 3 décimales et un point (indépendant des réglages Windows).
Private Function FmtN(ByVal x As Double) As String
    Dim s As String, v As Double, e As Double, f As Double
    s = ""
    v = x
    If v < 0 Then
        s = "-"
        v = -v
    End If
    v = Int(v * 1000 + 0.5)
    If v = 0 Then s = ""
    e = Int(v / 1000)
    f = v - e * 1000
    FmtN = s & CStr(e) & "." & Right("000" & CStr(f), 3)
End Function

Private Function Horodatage() As String
    Horodatage = Format(Now, "yyyy-mm-dd") & "_" & Format(Now, "hh") & "h" & Format(Now, "nn") & "m" & Format(Now, "ss") & "s"
End Function

Private Function DateHeureLisible() As String
    DateHeureLisible = Format(Now, "dd/mm/yyyy hh:nn:ss")
End Function
