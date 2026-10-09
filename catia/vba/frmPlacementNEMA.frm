VERSION 5.00
Begin {C62A69F0-16DC-11CE-9E98-00AA00574A4F} frmPlacementNEMA
   Caption         =   "Placement raccords NEMA"
   ClientHeight    =   7500
   ClientLeft      =   45
   ClientTop       =   390
   ClientWidth     =   7260
   StartUpPosition =   1  'CenterOwner
End
Attribute VB_Name = "frmPlacementNEMA"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = True
Attribute VB_Exposed = False
'==============================================================================
'  frmPlacementNEMA - fenêtre de placement des raccords NEMA
'------------------------------------------------------------------------------
'  Tous les contrôles sont créés par le code (UserForm_Initialize) : la
'  fenêtre n'a besoin d'aucun fichier .frx. Le calcul est dans le module
'  modPlacementNEMA.
'
'  Boutons :
'   - Analyser raccord / disjoncteur : choisir l'instance en la sélectionnant
'     dans l'arbre ou la vue 3D (la détection automatique est faite à
'     l'ouverture) ;
'   - Création : un raccord sur chaque Face NEMA libre, d'un seul coup ;
'   - Face suivante : déplace le raccord courant sur la face libre suivante
'     (si toutes sont équipées : passe au raccord de la face suivante) ;
'   - Axes suivants : repose le raccord courant avec l'appariement de trous
'     suivant, sur la même face.
'==============================================================================
Option Explicit

Private WithEvents btnAnaRac As MSForms.CommandButton
Private WithEvents btnAnaDisj As MSForms.CommandButton
Private WithEvents btnCreation As MSForms.CommandButton
Private WithEvents btnFaceSuiv As MSForms.CommandButton
Private WithEvents btnAxesSuiv As MSForms.CommandButton
Private WithEvents btnFermer As MSForms.CommandButton
Private txtRac As MSForms.TextBox
Private txtNbAxes As MSForms.TextBox
Private txtDisj As MSForms.TextBox
Private txtNbFaces As MSForms.TextBox
Private cboMode As MSForms.ComboBox
Private cboOrient As MSForms.ComboBox
Private txtTable As MSForms.TextBox
Private chkRot As MSForms.CheckBox
Private chkIgnorer As MSForms.CheckBox
Private lblCourant As MSForms.Label
Private txtEtat As MSForms.TextBox
Private lblJournal As MSForms.Label


'==============================================================================
'  OUVERTURE ET FERMETURE
'==============================================================================
Private Sub UserForm_Initialize()
    ConstruireInterface
    InitialiserSession
    ChargerOptions
    RafraichirAffichage
End Sub

Private Sub UserForm_QueryClose(Cancel As Integer, CloseMode As Integer)
    LireOptions
    FinSession
End Sub

Private Sub btnFermer_Click()
    Unload Me
End Sub


'==============================================================================
'  BOUTONS
'==============================================================================
Private Sub btnAnaRac_Click()
    LireOptions
    Me.Hide
    ChoisirRaccordParSelection
    RafraichirAffichage
    Me.Show
End Sub

Private Sub btnAnaDisj_Click()
    LireOptions
    Me.Hide
    ChoisirDisjoncteurParSelection
    RafraichirAffichage
    Me.Show
End Sub

Private Sub btnCreation_Click()
    LireOptions
    Occupe True
    CreerTousLesRaccords
    Occupe False
    RafraichirAffichage
End Sub

Private Sub btnFaceSuiv_Click()
    LireOptions
    If gCourantChemin = "" Then
        ' Aucun raccord courant : on demande lequel corriger.
        Me.Hide
        If ChoisirRaccordACorriger() Then FaceSuivante
        RafraichirAffichage
        Me.Show
    Else
        Occupe True
        FaceSuivante
        Occupe False
        RafraichirAffichage
    End If
End Sub

Private Sub btnAxesSuiv_Click()
    LireOptions
    If gCourantChemin = "" Then
        Me.Hide
        If ChoisirRaccordACorriger() Then AxesSuivants
        RafraichirAffichage
        Me.Show
    Else
        Occupe True
        AxesSuivants
        Occupe False
        RafraichirAffichage
    End If
End Sub


'==============================================================================
'  ÉCHANGES AVEC LE MODULE
'==============================================================================
Private Sub ChargerOptions()
    If gOptMode = "EXEMPLE" Then
        cboMode.ListIndex = 1
    Else
        cboMode.ListIndex = 0
    End If
    Select Case gOptOrientation
        Case "OPPOSE"
            cboOrient.ListIndex = 1
        Case "MEME"
            cboOrient.ListIndex = 2
        Case Else
            cboOrient.ListIndex = 0
    End Select
    txtTable.Text = gOptTable
    chkRot.Value = gOptRotation180
    chkIgnorer.Value = gOptIgnorer
End Sub

Private Sub LireOptions()
    If cboMode.ListIndex = 1 Then
        gOptMode = "EXEMPLE"
    Else
        gOptMode = "COMPLET"
    End If
    Select Case cboOrient.ListIndex
        Case 1
            gOptOrientation = "OPPOSE"
        Case 2
            gOptOrientation = "MEME"
        Case Else
            gOptOrientation = "AUTO"
    End Select
    gOptTable = Trim(txtTable.Text)
    gOptRotation180 = chkRot.Value
    gOptIgnorer = chkIgnorer.Value
End Sub

Private Sub RafraichirAffichage()
    Dim i As Long, t As String

    If gRacChemin <> "" Then
        txtRac.Text = gRacPN & " (" & gRacChemin & ")"
        txtNbAxes.Text = CStr(gNbAxesRac)
    Else
        txtRac.Text = ""
        txtNbAxes.Text = ""
    End If
    If gDisjChemin <> "" Then
        txtDisj.Text = gDisjPN & " (" & gDisjChemin & ")"
        txtNbFaces.Text = CStr(gNbFaces)
    Else
        txtDisj.Text = ""
        txtNbFaces.Text = ""
    End If
    ' Rappel de la table utilisée quand le champ est vide
    If Trim(txtTable.Text) = "" And gNbAxesRac > 0 Then
        t = ""
        For i = 1 To gNbAxesRac
            If i > 1 Then t = t & ","
            t = t & gAxesRac(i)
        Next
        txtTable.ControlTipText = "Vide = correspondance directe : " & t
    End If
    lblCourant.Caption = DescriptionPoseCourante()
    lblJournal.Caption = "Journal : " & gCheminJournal
    txtEtat.Text = gMessages
    txtEtat.SelStart = Len(txtEtat.Text)
End Sub

Private Sub Occupe(ByVal oui As Boolean)
    If oui Then
        Me.MousePointer = fmMousePointerHourGlass
        txtEtat.Text = gMessages & "Travail en cours..." & vbCrLf
    Else
        Me.MousePointer = fmMousePointerDefault
    End If
    DoEvents
End Sub


'==============================================================================
'  CONSTRUCTION DE L'INTERFACE
'==============================================================================
Private Sub ConstruireInterface()
    Dim fra As MSForms.Frame, lbl As MSForms.Label

    Me.Caption = "Placement raccords NEMA v" & VERSION_OUTIL
    Me.Width = 372
    Me.Height = 404

    ' Raccord et disjoncteur
    Set btnAnaRac = NouveauBouton(Me, "btnAnaRac", "Analyser raccord" & vbLf & "sélectionné", 6, 6, 132, 32, True)
    Set txtRac = NouveauChamp(Me, "txtRac", 144, 12, 170)
    Set txtNbAxes = NouveauChamp(Me, "txtNbAxes", 320, 12, 38)
    txtNbAxes.TextAlign = fmTextAlignCenter
    Set lbl = NouvelleEtiquette(Me, "lblAxes", "axes", 320, 31, 38)
    lbl.TextAlign = fmTextAlignCenter
    Set lbl = NouvelleEtiquette(Me, "lblRac", "Raccord modèle : PartNumber (instance)", 144, 31, 170)

    Set btnAnaDisj = NouveauBouton(Me, "btnAnaDisj", "Analyser disjoncteur" & vbLf & "sélectionné", 6, 44, 132, 32, True)
    Set txtDisj = NouveauChamp(Me, "txtDisj", 144, 50, 170)
    Set txtNbFaces = NouveauChamp(Me, "txtNbFaces", 320, 50, 38)
    txtNbFaces.TextAlign = fmTextAlignCenter
    Set lbl = NouvelleEtiquette(Me, "lblFaces", "faces", 320, 69, 38)
    lbl.TextAlign = fmTextAlignCenter
    Set lbl = NouvelleEtiquette(Me, "lblDisj", "Disjoncteur : PartNumber (instance)", 144, 69, 170)

    ' Options
    Set fra = Me.Controls.Add("Forms.Frame.1", "fraOptions", True)
    fra.Caption = "Options"
    fra.Left = 6
    fra.Top = 84
    fra.Width = 352
    fra.Height = 96
    Set lbl = NouvelleEtiquette(fra, "lblMode", "Contraintes :", 6, 8, 80)
    Set cboMode = fra.Controls.Add("Forms.ComboBox.1", "cboMode", True)
    cboMode.Left = 90
    cboMode.Top = 5
    cboMode.Width = 252
    cboMode.Style = fmStyleDropDownList
    cboMode.AddItem "Face + tous les axes du raccord (" & "1 + nb d'axes)"
    cboMode.AddItem "Face + axes de l'exemple (" & AXES_MODE_EXEMPLE & ")"

    Set lbl = NouvelleEtiquette(fra, "lblOrient", "Orientation face :", 6, 30, 80)
    Set cboOrient = fra.Controls.Add("Forms.ComboBox.1", "cboOrient", True)
    cboOrient.Left = 90
    cboOrient.Top = 27
    cboOrient.Width = 110
    cboOrient.Style = fmStyleDropDownList
    cboOrient.AddItem "Automatique"
    cboOrient.AddItem "Sens opposé"
    cboOrient.AddItem "Même sens"

    Set chkIgnorer = fra.Controls.Add("Forms.CheckBox.1", "chkIgnorer", True)
    chkIgnorer.Caption = "Ignorer les faces déjà équipées"
    chkIgnorer.Left = 208
    chkIgnorer.Top = 27
    chkIgnorer.Width = 140
    chkIgnorer.Height = 18

    Set lbl = NouvelleEtiquette(fra, "lblTable", "Table des axes :", 6, 52, 80)
    Set txtTable = fra.Controls.Add("Forms.TextBox.1", "txtTable", True)
    txtTable.Left = 90
    txtTable.Top = 49
    txtTable.Width = 110
    txtTable.Height = 18

    Set chkRot = fra.Controls.Add("Forms.CheckBox.1", "chkRot", True)
    chkRot.Caption = "Rotation 180°"
    chkRot.Left = 208
    chkRot.Top = 49
    chkRot.Width = 140
    chkRot.Height = 18

    Set lbl = NouvelleEtiquette(fra, "lblAide", "Table : k-ième valeur = trou j de la plage (Axe NEMA n.j) qui reçoit Axe NEMA.k. Vide = direct : Axe NEMA.1 -> n.1, Axe NEMA.2 -> n.2...", 6, 70, 340)
    lbl.Height = 22
    lbl.WordWrap = True
    lbl.Font.Size = 7

    ' Contraintes de positionnement
    Set fra = Me.Controls.Add("Forms.Frame.1", "fraContraintes", True)
    fra.Caption = "Contraintes de positionnement"
    fra.Left = 6
    fra.Top = 186
    fra.Width = 352
    fra.Height = 48
    Set btnCreation = NouveauBouton(fra, "btnCreation", "Création", 6, 6, 108, 26, True)
    Set btnFaceSuiv = NouveauBouton(fra, "btnFaceSuiv", "Face suivante", 120, 6, 108, 26, True)
    Set btnAxesSuiv = NouveauBouton(fra, "btnAxesSuiv", "Axes suivants", 234, 6, 108, 26, True)
    btnCreation.ControlTipText = "Pose un raccord sur chaque Face NEMA libre du disjoncteur"
    btnFaceSuiv.ControlTipText = "Déplace le raccord courant sur la face libre suivante"
    btnAxesSuiv.ControlTipText = "Repose le raccord courant avec l'appariement de trous suivant"

    ' Raccord courant, messages, journal
    Set lblCourant = NouvelleEtiquette(Me, "lblCourant", "", 6, 240, 352)
    lblCourant.Font.Bold = True
    Set txtEtat = Me.Controls.Add("Forms.TextBox.1", "txtEtat", True)
    txtEtat.Left = 6
    txtEtat.Top = 256
    txtEtat.Width = 352
    txtEtat.Height = 92
    txtEtat.MultiLine = True
    txtEtat.WordWrap = True
    txtEtat.ScrollBars = fmScrollBarsVertical
    txtEtat.Locked = True
    txtEtat.Font.Size = 7
    Set lblJournal = NouvelleEtiquette(Me, "lblJournal", "", 6, 354, 266)
    lblJournal.Height = 20
    lblJournal.WordWrap = True
    lblJournal.Font.Size = 7
    Set btnFermer = NouveauBouton(Me, "btnFermer", "Fermer", 278, 354, 80, 22, False)
End Sub

Private Function NouveauBouton(ByVal conteneur As Object, ByVal nom As String, ByVal texte As String, ByVal x As Single, ByVal y As Single, ByVal l As Single, ByVal h As Single, ByVal gras As Boolean) As MSForms.CommandButton
    Dim b As MSForms.CommandButton
    Set b = conteneur.Controls.Add("Forms.CommandButton.1", nom, True)
    b.Caption = texte
    b.Left = x
    b.Top = y
    b.Width = l
    b.Height = h
    b.WordWrap = True
    b.Font.Bold = gras
    Set NouveauBouton = b
End Function

' Champ en lecture seule (fond gris).
Private Function NouveauChamp(ByVal conteneur As Object, ByVal nom As String, ByVal x As Single, ByVal y As Single, ByVal l As Single) As MSForms.TextBox
    Dim t As MSForms.TextBox
    Set t = conteneur.Controls.Add("Forms.TextBox.1", nom, True)
    t.Left = x
    t.Top = y
    t.Width = l
    t.Height = 18
    t.Locked = True
    t.BackColor = &H8000000F
    Set NouveauChamp = t
End Function

Private Function NouvelleEtiquette(ByVal conteneur As Object, ByVal nom As String, ByVal texte As String, ByVal x As Single, ByVal y As Single, ByVal l As Single) As MSForms.Label
    Dim e As MSForms.Label
    Set e = conteneur.Controls.Add("Forms.Label.1", nom, True)
    e.Caption = texte
    e.Left = x
    e.Top = y
    e.Width = l
    e.Height = 12
    Set NouvelleEtiquette = e
End Function
